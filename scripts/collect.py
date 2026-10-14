"""The robot's data collector.

Runs inside GitHub Actions every 15 minutes and writes fresh files into data/:
  market.json  - total market cap, 24h volume, BTC dominance (CoinGecko) + Fear & Greed (alternative.me)
  events.json  - US economic calendar for the next 3 weeks (ForexFactory feed for this week and next) + Fed meeting dates
  news.json    - last 24h headlines from CoinDesk, Cointelegraph, The Block and Decrypt (RSS)

If a source fails, the file currently live on the site is kept, so the page never goes blank.
Uses only Python's standard library, so there is nothing to install.
"""
import email.utils
import json
import os
import sys
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
    g = get_json("https://api.coingecko.com/api/v3/global",
                 {"x-cg-demo-api-key": key} if key else None)["data"]
    fng = get_json("https://api.alternative.me/fng/?limit=1")["data"][0]
    return {
        "total_market_cap_usd": g["total_market_cap"]["usd"],
        "market_cap_change_24h_pct": g["market_cap_change_percentage_24h_usd"],
        "total_volume_usd": g["total_volume"]["usd"],
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
    if not items:
        raise RuntimeError("no headlines from any feed")
    items.sort(key=lambda i: i["published"], reverse=True)
    return {"items": items[:30]}


if __name__ == "__main__":
    for name, collect in (("market", market), ("events", events), ("news", news)):
        try:
            save(name, collect())
        except Exception as e:
            keep_live(name, e)
