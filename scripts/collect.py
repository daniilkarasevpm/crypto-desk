"""The robot's data collector.

Runs inside GitHub Actions every 15 minutes and writes fresh files into data/:
  market.json  - total market cap, 24h volume, BTC dominance (CoinGecko) + Fear & Greed (alternative.me)
  events.json  - US economic calendar for the next 3 weeks (ForexFactory feed for this week and next) + Fed meeting dates
  news.json    - last 24h headlines from CoinDesk, Cointelegraph, The Block and Decrypt (RSS)
  analysts.json - AI summary (Google Gemini, free tier) of today's analysis, 3 times a day

If a source fails, the file currently live on the site is kept, so the page never goes blank.
Uses only Python's standard library, so there is nothing to install.
"""
import email.utils
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
LIVE_SITE = "https://daniilkarasevpm.github.io/crypto-desk/data/"
NOW = datetime.now(timezone.utc)
UA = {"User-Agent": "crypto-desk/1.0 (+https://github.com/daniilkarasevpm/crypto-desk)"}


def get(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def get_json(url, headers=None):
    return json.loads(get(url, headers))


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def save(name, payload):
    payload = {"sample": False, "updated": iso(NOW), **payload}
    (DATA / f"{name}.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"✓ {name}.json written")


def keep_live(name, error):
    """A source failed: fall back to the copy currently published on the site."""
    print(f"! {name}: {error}", file=sys.stderr)
    try:
        (DATA / f"{name}.json").write_bytes(get(LIVE_SITE + f"{name}.json"))
        print(f"  kept the live {name}.json")
    except Exception as e:  # first run, or the site is down: keep the file from the repo
        print(f"  could not fetch live copy ({e}); keeping repo file", file=sys.stderr)


# ---------- Market statistics ----------
def market():
    key = os.environ.get("COINGECKO_API_KEY", "")
    auth = {"x-cg-demo-api-key": key} if key else None
    g = get_json("https://api.coingecko.com/api/v3/global", auth)["data"]
    # CoinGecko's global volume figure is sometimes inflated by junk tokens (we saw $80T),
    # so add up the 24h volume of the 250 largest coins instead.
    top = get_json("https://api.coingecko.com/api/v3/coins/markets"
                   "?vs_currency=usd&order=market_cap_desc&per_page=250&page=1", auth)
    volume = sum(c.get("total_volume") or 0 for c in top)
    fng = get_json("https://api.alternative.me/fng/?limit=1")["data"][0]
    return {
        "total_market_cap_usd": g["total_market_cap"]["usd"],
        "market_cap_change_24h_pct": g["market_cap_change_percentage_24h_usd"],
        "total_volume_usd": volume,
        "btc_dominance_pct": g["market_cap_percentage"]["btc"],
        "fear_greed": {"value": int(fng["value"]), "label": fng["value_classification"]},
    }


# ---------- Events calendar ----------
IMPACT = {"High": "high", "Medium": "medium"}


def events():
    found = []
    feeds_ok = 0
    for week in ("thisweek", "nextweek"):
        try:
            rows = get_json(f"https://nfs.faireconomy.media/ff_calendar_{week}.json")
            feeds_ok += 1
        except Exception as e:
            print(f"  calendar {week} unavailable: {e}", file=sys.stderr)
            continue
        for r in rows:
            if r.get("country") != "USD" or r.get("impact") not in IMPACT:
                continue
            found.append({
                "date": iso(datetime.fromisoformat(r["date"])),
                "title": "US " + r["title"],
                "impact": IMPACT[r["impact"]],
                "category": "macro",
                "forecast": r.get("forecast") or "",
                "previous": r.get("previous") or "",
            })
    if not feeds_ok:
        raise RuntimeError("no calendar feed reachable")

    # Fed meetings further ahead come from a hand-kept file; skip days the feed already covers
    covered = {e["date"][:10] for e in found if "FOMC" in e["title"] or "Federal Funds" in e["title"]}
    manual = json.loads((DATA / "fed-meetings.json").read_text(encoding="utf-8"))["events"]
    found += [e for e in manual if e["date"][:10] not in covered]

    horizon = NOW + timedelta(days=21)
    keep = [e for e in found
            if NOW - timedelta(hours=1) <= datetime.fromisoformat(e["date"].replace("Z", "+00:00")) <= horizon]
    keep.sort(key=lambda e: e["date"])
    return {"events": keep}


# ---------- News ----------
FEEDS = {
    "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "Cointelegraph": "https://cointelegraph.com/rss",
    "The Block": "https://www.theblock.co/rss.xml",
    "Decrypt": "https://decrypt.co/feed",
}


ARTICLES = []  # today's articles with their short descriptions, reused by the analysts step


def news():
    items, seen = [], set()
    for source, url in FEEDS.items():
        try:
            root = ET.fromstring(get(url))
        except Exception as e:
            print(f"  feed {source} unavailable: {e}", file=sys.stderr)
            continue
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            link = (it.findtext("link") or "").strip().split("?utm_")[0]
            try:
                published = email.utils.parsedate_to_datetime(it.findtext("pubDate"))
            except Exception:
                continue
            if not title or not link or NOW - published > timedelta(hours=24) or title.lower() in seen:
                continue
            seen.add(title.lower())
            items.append({"title": title, "source": source, "url": link, "published": iso(published)})
            text = re.sub(r"<[^>]+>", " ", html.unescape(it.findtext("description") or ""))
            ARTICLES.append({**items[-1], "summary": " ".join(text.split())[:500]})
    if not items:
        raise RuntimeError("no headlines from any feed")
    items.sort(key=lambda i: i["published"], reverse=True)
    return {"items": items[:30]}


# ---------- Analysts' view (AI summary) ----------
SLOTS_UTC = (11, 16, 21)  # 7 am, 12 pm and 5 pm New York time (summer); one summary per slot
# "-latest" names always point at Google's current models; older fixed names get retired
MODELS = ("gemini-flash-latest", "gemini-flash-lite-latest")
COIN_WORDS = re.compile(r"\b(bitcoin|btc|ether|ethereum|eth|solana|sol|crypto market|price|analyst|forecast|"
                        r"predict|outlook|rally|sell-?off|support|resistance|fed|etf)\b", re.I)

PROMPT = """You summarise today's public crypto market commentary for a trader who holds BTC, ETH and SOL.
Use ONLY the articles and data below. Do not invent facts, numbers or sources.

Return JSON exactly in this shape:
{{
  "coins": {{
    "BTC": {{"mood": "bullish|neutral|bearish", "why": "one short sentence"}},
    "ETH": {{"mood": "...", "why": "..."}},
    "SOL": {{"mood": "...", "why": "..."}}
  }},
  "points": [{{"text": "one sentence: what analysts or the news expect and why", "url": "<url of the article it comes from>"}}],
  "levels": "price levels analysts mention today, with the coin, or empty string if none",
  "risks": "the main risks for today in one or two sentences"
}}
Rules: 3 to 5 points; every point's url must be copied exactly from the articles list; mood reflects the
balance of today's commentary, not your own opinion; plain English, no hype.

Market now: {market}
Upcoming US events: {events}

Articles (last 24 hours):
{articles}
"""


def analysts_due():
    """True if the live summary was written before the most recent slot (or is still sample)."""
    try:
        live = json.loads(get(LIVE_SITE + "analysts.json"))
    except Exception:
        return True
    if live.get("sample"):
        return True
    written = datetime.fromisoformat(live["updated"].replace("Z", "+00:00"))
    slots = [NOW.replace(hour=h, minute=0, second=0, microsecond=0) for h in SLOTS_UTC]
    slots += [t - timedelta(days=1) for t in slots]
    last_slot = max(t for t in slots if t <= NOW)
    return written < last_slot


def gemini_models(key):
    """Our preferred models, then any other Flash model this key can use (found by asking Google)."""
    names = list(MODELS)
    try:
        listing = get_json("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                           {"x-goog-api-key": key})
        for m in listing.get("models", []):
            name = m["name"].removeprefix("models/")
            if ("flash" in name and "generateContent" in m.get("supportedGenerationMethods", [])
                    and not any(w in name for w in ("image", "tts", "audio", "live", "preview", "exp"))
                    and name not in names):
                names.append(name)
    except Exception as e:
        print(f"  could not list Gemini models: {e}", file=sys.stderr)
    return names


def ask_gemini(prompt):
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY secret is not set")
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
    }).encode()
    errors = []
    for model in gemini_models(key)[:5]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        for attempt in range(3):  # "busy" (503) and "slow down" (429) usually clear within seconds
            req = urllib.request.Request(url, data=body, method="POST", headers={
                **UA, "Content-Type": "application/json", "x-goog-api-key": key})
            try:
                with urllib.request.urlopen(req, timeout=90) as res:
                    out = json.loads(res.read())
                print(f"  summary written by {model}")
                return json.loads(out["candidates"][0]["content"]["parts"][0]["text"])
            except urllib.error.HTTPError as e:
                errors.append(f"{model}: HTTP {e.code}")
                if e.code in (429, 500, 503) and attempt < 2:
                    time.sleep(10 * (attempt + 1))
                    continue
                break
            except Exception as e:
                errors.append(f"{model}: {e}")
                break
    raise RuntimeError("; ".join(errors))


def analysts(market_data, events_data):
    recent = sorted(ARTICLES, key=lambda a: a["published"], reverse=True)
    articles = [a for a in recent if COIN_WORDS.search(a["title"] + " " + a["summary"])][:40]
    if len(articles) < 3:
        raise RuntimeError(f"only {len(articles)} relevant articles today")
    listing = "\n".join(f"- [{a['source']}] {a['title']} | {a['summary']} | url: {a['url']}" for a in articles)
    m = market_data or {}
    market_line = (f"total crypto market cap ${m.get('total_market_cap_usd', 0) / 1e12:.2f}T "
                   f"({m.get('market_cap_change_24h_pct', 0):+.1f}% 24h), Fear & Greed "
                   f"{m.get('fear_greed', {}).get('value', '?')} ({m.get('fear_greed', {}).get('label', '?')})")
    events_line = "; ".join(f"{e['date'][:16]} {e['title']}" for e in (events_data or {}).get("events", [])[:8]) or "none"
    ai = ask_gemini(PROMPT.format(market=market_line, events=events_line, articles=listing))

    # Check the answer: only known moods, and every point must link to one of today's articles
    by_url = {a["url"]: a for a in articles}
    coins = {}
    for sym in ("BTC", "ETH", "SOL"):
        c = ai.get("coins", {}).get(sym, {})
        mood = c.get("mood") if c.get("mood") in ("bullish", "neutral", "bearish") else "neutral"
        coins[sym] = {"mood": mood, "why": str(c.get("why", ""))[:200]}
    points = []
    for p in ai.get("points", []):
        src = by_url.get(str(p.get("url", "")).strip())
        if src and p.get("text"):
            points.append({"text": str(p["text"])[:300], "source": src["source"], "url": src["url"]})
    if not points:
        raise RuntimeError("summary had no points linked to real articles")
    return {"coins": coins, "points": points[:5],
            "levels": str(ai.get("levels") or "None mentioned today.")[:300],
            "risks": str(ai.get("risks") or "")[:400]}


def run(name, collect):
    try:
        data = collect()
        save(name, data)
        return data
    except Exception as e:
        keep_live(name, e)
        return None


if __name__ == "__main__":
    market_data = run("market", market)
    events_data = run("events", events)
    run("news", news)
    if analysts_due():
        run("analysts", lambda: analysts(market_data, events_data))
    else:
        keep_live("analysts", "not due yet (runs at 11:00, 16:00 and 21:00 UTC)")
