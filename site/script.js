// Crypto Desk: fills the page with data.
// Charts: live prices from CoinGecko (Binance as backup), loaded in the browser and refreshed every minute.
// Other blocks: read files from data/ (sample files until the robot fills them in Steps 5-6).

const COINS = [
  { id: "bitcoin",  symbol: "BTC", name: "Bitcoin",  pair: "BTCUSDT", big: true },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", pair: "ETHUSDT", big: true },
  { id: "solana",   symbol: "SOL", name: "Solana",   pair: "SOLUSDT", big: false },
];
// For each range: days for CoinGecko, candle size and count for the Binance backup
const RANGES = {
  "1D":  { days: 1,  interval: "15m", limit: 96 },
  "7D":  { days: 7,  interval: "1h",  limit: 168 },
  "30D": { days: 30, interval: "4h",  limit: 180 },
};
const REFRESH_MS = 60 * 1000;

// ---------- Small helpers ----------
const $ = (id) => document.getElementById(id);

function usd(n) {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return "$" + (n / 1e9).toFixed(1) + "B";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
}
function pct(n) {
  const cls = n >= 0 ? "up" : "down";
  return `<span class="${cls}">${n >= 0 ? "+" : ""}${n.toFixed(2)}%</span>`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function load(name) {
  const res = await fetch(`data/${name}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${name}.json: ${res.status}`);
  return res.json();
}
// The yellow badge lists blocks still showing sample data
const sampleBlocks = new Set();
function markSample(data, block) {
  if (!data || !data.sample) return;
  sampleBlocks.add(block);
  $("sample-badge").textContent = "Sample data: " + [...sampleBlocks].join(", ");
  $("sample-badge").hidden = false;
}

// ---------- 1. Market statistics ----------
async function renderStats() {
  try {
    const m = await load("market");
    markSample(m, "stats");
    $("stat-mcap").textContent = usd(m.total_market_cap_usd);
    $("stat-mcap-change").innerHTML = pct(m.market_cap_change_24h_pct) + " 24h";
    $("stat-volume").textContent = usd(m.total_volume_usd);
    $("stat-dominance").textContent = m.btc_dominance_pct.toFixed(1) + "%";
    $("stat-fng").textContent = m.fear_greed.value;
    $("stat-fng-label").textContent = m.fear_greed.label;
    $("updated").textContent = "Updated " + new Date(m.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    $("updated").textContent = "Stats unavailable";
    console.error(e);
  }
}

// ---------- 2. Price charts ----------
// Live prices. Results are kept for a minute so switching ranges doesn't re-download.
const priceCache = {};

async function fromCoinGecko(coin, range) {
  const url = `https://api.coingecko.com/api/v3/coins/${coin.id}/market_chart?vs_currency=usd&days=${RANGES[range].days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const json = await res.json();
  return json.prices.map(([ms, price]) => ({ time: Math.floor(ms / 1000), value: price }));
}

async function fromBinance(coin, range) {
  const { interval, limit } = RANGES[range];
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${coin.pair}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const rows = await res.json();
  // Each row is a candle: [open time, open, high, low, close, ...]; we chart the close price
  return rows.map((r) => ({ time: Math.floor(r[0] / 1000), value: parseFloat(r[4]) }));
}

async function getPrices(coin, range) {
  const key = coin.id + range;
  const hit = priceCache[key];
  if (hit && Date.now() - hit.at < REFRESH_MS) return hit;
  let data;
  let source = "CoinGecko";
  try {
    data = await fromCoinGecko(coin, range);
  } catch (e) {
    console.warn(coin.symbol, "CoinGecko failed, trying Binance:", e.message);
    data = await fromBinance(coin, range);
    source = "Binance";
  }
  // Charts need strictly increasing times
  data = data.filter((p, i) => i === 0 || p.time > data[i - 1].time);
  const result = { data, source, at: Date.now() };
  priceCache[key] = result;
  return result;
}

function buildChartCard(coin) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="coin-head">
      <span class="coin-name">${coin.symbol} <span class="muted">${coin.name}</span></span>
      <span><span class="coin-price" id="price-${coin.symbol}">–</span> <span id="change-${coin.symbol}"></span></span>
    </div>
    <div class="ranges" role="group" aria-label="${coin.symbol} time range">
      ${Object.keys(RANGES).map((r, i) => `<button type="button" data-range="${r}" aria-pressed="${i === 0}">${r}</button>`).join("")}
    </div>
    <div class="chart" id="chart-${coin.symbol}"></div>
    <p class="source" id="source-${coin.symbol}"></p>`;
  $("charts").appendChild(card);

  const css = getComputedStyle(document.documentElement);
  const chart = LightweightCharts.createChart($(`chart-${coin.symbol}`), {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css.getPropertyValue("--muted").trim() },
    grid: { vertLines: { visible: false }, horzLines: { color: css.getPropertyValue("--line").trim() } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true },
    handleScroll: false,
    handleScale: false,
  });
  const big = coin.big;                                 // no cents on BTC/ETH axis labels
  const series = chart.addAreaSeries({
    lineWidth: 2,
    priceFormat: { type: "price", precision: big ? 0 : 2, minMove: big ? 1 : 0.01 },
  });

  let current = "1D";
  async function show(range) {
    current = range;
    let data, result;
    try {
      result = await getPrices(coin, range);
      data = result.data;
    } catch (e) {
      console.error(coin.symbol, e);
      $(`change-${coin.symbol}`).innerHTML = '<span class="muted">Prices unavailable, retrying…</span>';
      $(`source-${coin.symbol}`).textContent = "Could not reach CoinGecko or Binance: " + e.message;
      return;
    }
    if (range !== current || !data.length) return;      // a newer click won the race
    const first = data[0].value, last = data[data.length - 1].value;
    const change = ((last - first) / first) * 100;
    const color = getComputedStyle(document.documentElement).getPropertyValue(change >= 0 ? "--up" : "--down").trim();
    series.applyOptions({ lineColor: color, topColor: color + "55", bottomColor: color + "00" });
    series.setData(data);
    chart.timeScale().fitContent();
    $(`price-${coin.symbol}`).textContent = usd(last);
    $(`change-${coin.symbol}`).innerHTML = pct(change) + ` <span class="muted">${range}</span>`;
    const time = new Date(result.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $(`source-${coin.symbol}`).textContent = `Live · ${result.source} · ${time}`;
  }

  card.querySelectorAll(".ranges button").forEach((btn) => {
    btn.addEventListener("click", () => {
      card.querySelectorAll(".ranges button").forEach((b) => b.setAttribute("aria-pressed", b === btn));
      show(btn.dataset.range);
    });
  });
  show("1D");
  setInterval(() => show(current), REFRESH_MS);         // keep prices fresh while the page is open
}

function renderCharts() {
  if (!window.LightweightCharts) {
    $("charts").innerHTML = '<p class="card muted">Charts could not load. Check your connection and refresh.</p>';
    return;
  }
  COINS.forEach(buildChartCard);
}

// ---------- 3. Events calendar ----------
function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
function countdown(d) {
  const mins = Math.round((d - Date.now()) / 60000);
  if (mins < 0) return "passed";
  if (mins < 60) return `in ${mins} min`;
  if (mins < 48 * 60) return `in ${Math.round(mins / 60)}h`;
  return `in ${Math.round(mins / 1440)} days`;
}

async function renderEvents() {
  try {
    const data = await load("events");
    markSample(data, "events");
    const upcoming = data.events
      .map((e) => ({ ...e, d: new Date(e.date) }))
      .filter((e) => e.d > Date.now() - 3600000)
      .sort((a, b) => a.d - b.d);
    if (!upcoming.length) { $("events-list").innerHTML = '<p class="muted">No major US events in the next three weeks.</p>'; return; }
    let html = "", lastDay = "";
    for (const e of upcoming) {
      const label = dayLabel(e.d);
      if (label !== lastDay) { html += `<p class="day">${label}</p>`; lastDay = label; }
      const time = e.d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const numbers = [e.forecast && `Forecast ${esc(e.forecast)}`, e.previous && `Prev ${esc(e.previous)}`].filter(Boolean).join(" · ");
      html += `<div class="event ${e.category}">
        <span class="impact ${e.impact}">${e.impact === "medium" ? "MED" : e.impact.toUpperCase()}</span>
        <span class="title">${esc(e.title)}${numbers ? `<span class="numbers">${numbers}</span>` : ""}</span>
        <span class="when">${time} · ${countdown(e.d)}</span></div>`;
    }
    $("events-list").innerHTML = html;
  } catch (e) {
    $("events-list").innerHTML = '<p class="muted">Calendar unavailable right now.</p>';
    console.error(e);
  }
}

// ---------- 4. Analysts' view ----------
async function renderAnalysts() {
  try {
    const a = await load("analysts");
    markSample(a, "analysts");
    const moods = Object.entries(a.coins)
      .map(([sym, c]) => `<span class="mood ${c.mood}">${sym}: ${c.mood[0].toUpperCase() + c.mood.slice(1)}</span>`).join("");
    const whys = Object.entries(a.coins).filter(([, c]) => c.why)
      .map(([sym, c]) => `<li><strong>${sym}:</strong> ${esc(c.why)}</li>`).join("");
    const points = a.points
      .map((p) => `<li>${esc(p.text)} <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.source)}</a></li>`).join("");
    const at = new Date(a.updated);
    const sameDay = at.toDateString() === new Date().toDateString();
    const written = (sameDay ? "" : at.toLocaleDateString([], { day: "numeric", month: "short" }) + ", ")
      + at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("analysts-body").innerHTML = `
      <div class="moods">${moods}</div>
      ${whys ? `<ul class="whys">${whys}</ul>` : ""}
      <ul class="points">${points}</ul>
      <p class="sub"><strong>Levels watched:</strong> ${esc(a.levels)}</p>
      <p class="sub"><strong>Key risks:</strong> ${esc(a.risks)}</p>
      <p class="sub">Written at ${written}</p>`;
  } catch (e) {
    $("analysts-body").innerHTML = '<p class="muted">Summary unavailable right now.</p>';
    console.error(e);
  }
}

// ---------- 5. News ----------
function ago(d) {
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}
async function renderNews() {
  try {
    const n = await load("news");
    markSample(n, "news");
    $("news-list").innerHTML = n.items.slice(0, 10).map((i) =>
      `<li><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
       <span class="src">${esc(i.source)} · ${ago(new Date(i.published))}</span></li>`).join("");
  } catch (e) {
    $("news-list").innerHTML = '<li class="muted">News unavailable right now.</li>';
    console.error(e);
  }
}

renderStats();
renderCharts();
renderEvents();
renderAnalysts();
renderNews();
