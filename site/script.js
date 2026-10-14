// Crypto Desk: fills the page with data.
// Step 3: charts use generated sample prices; the other blocks read sample files from data/.
// Later steps replace these with live prices (Step 4) and robot-collected files (Steps 5-6).

const COINS = [
  { id: "bitcoin",  symbol: "BTC", name: "Bitcoin",  start: 64000 },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", start: 2600 },
  { id: "solana",   symbol: "SOL", name: "Solana",   start: 150 },
];
const RANGES = { "1D": 1, "7D": 7, "30D": 30 };

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
function markSample(data) {
  if (data && data.sample) $("sample-badge").hidden = false;
}

// ---------- 1. Market statistics ----------
async function renderStats() {
  try {
    const m = await load("market");
    markSample(m);
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
// Sample prices: a random walk, so the layout can be judged before real data is connected.
function samplePrices(start, days) {
  const points = days === 1 ? 96 : days * 24;           // every 15 min for 1D, hourly otherwise
  const step = (days * 86400) / points;
  const now = Math.floor(Date.now() / 1000);
  let price = start;
  const data = [];
  for (let i = points; i >= 0; i--) {
    price *= 1 + (Math.random() - 0.48) * 0.006;
    data.push({ time: now - Math.round(i * step), value: +price.toFixed(2) });
  }
  return data;
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
    <div class="chart" id="chart-${coin.symbol}"></div>`;
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
  const big = coin.start >= 1000;                       // no cents on BTC/ETH axis labels
  const series = chart.addAreaSeries({
    lineWidth: 2,
    priceFormat: { type: "price", precision: big ? 0 : 2, minMove: big ? 1 : 0.01 },
  });

  function show(range) {
    const data = samplePrices(coin.start, RANGES[range]);
    const first = data[0].value, last = data[data.length - 1].value;
    const change = ((last - first) / first) * 100;
    const color = getComputedStyle(document.documentElement).getPropertyValue(change >= 0 ? "--up" : "--down").trim();
    series.applyOptions({ lineColor: color, topColor: color + "55", bottomColor: color + "00" });
    series.setData(data);
    chart.timeScale().fitContent();
    $(`price-${coin.symbol}`).textContent = usd(last);
    $(`change-${coin.symbol}`).innerHTML = pct(change) + ` <span class="muted">${range}</span>`;
  }

  card.querySelectorAll(".ranges button").forEach((btn) => {
    btn.addEventListener("click", () => {
      card.querySelectorAll(".ranges button").forEach((b) => b.setAttribute("aria-pressed", b === btn));
      show(btn.dataset.range);
    });
  });
  show("1D");
}

function renderCharts() {
  $("sample-badge").hidden = false;                     // charts are sample data in Step 3
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
    markSample(data);
    const upcoming = data.events
      .map((e) => ({ ...e, d: new Date(e.date) }))
      .filter((e) => e.d > Date.now() - 3600000)
      .sort((a, b) => a.d - b.d);
    if (!upcoming.length) { $("events-list").innerHTML = '<p class="muted">No events in the next two weeks.</p>'; return; }
    let html = "", lastDay = "";
    for (const e of upcoming) {
      const label = dayLabel(e.d);
      if (label !== lastDay) { html += `<p class="day">${label}</p>`; lastDay = label; }
      const time = e.d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      html += `<div class="event ${e.category}">
        <span class="impact ${e.impact}">${e.impact.toUpperCase()}</span>
        <span class="title">${esc(e.title)}</span>
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
    markSample(a);
    const moods = Object.entries(a.coins)
      .map(([sym, c]) => `<span class="mood ${c.mood}">${sym}: ${c.mood[0].toUpperCase() + c.mood.slice(1)}</span>`).join("");
    const points = a.points
      .map((p) => `<li>${esc(p.text)} <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.source)}</a></li>`).join("");
    const written = new Date(a.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("analysts-body").innerHTML = `
      <div class="moods">${moods}</div>
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
    markSample(n);
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
