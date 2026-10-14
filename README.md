# Crypto Desk

A one-screen crypto dashboard for daily trading:

- **Charts:** BTC, ETH and SOL prices (1 day, 7 days, 30 days), in USD
- **Calendar:** upcoming Fed and inflation events (FOMC, CPI, PCE, jobs reports), then crypto events
- **Market stats:** total market cap, 24h volume, BTC dominance, Fear & Greed Index
- **Analysts today:** an AI summary of today's public analysis, with a link to every source

Live at: https://daniilkarasevpm.github.io/crypto-desk/

> Summaries of public opinions only. Nothing on this site is financial advice.

## How it works

| Folder | What's in it |
|---|---|
| `site/` | The page itself: `index.html`, `styles.css`, `script.js` |
| `data/` | Small `.json` files the robot refreshes (market stats, events, news, analysts' summary) |
| `.github/workflows/` | The "robot": GitHub Actions that collect data and publish the site |

Prices on the charts load live in the browser. Everything else is collected by the robot on a schedule
and published together with the page.

## Secrets (Settings → Secrets and variables → Actions)

| Name | Used for | Needed from |
|---|---|---|
| `COINGECKO_API_KEY` | Market stats and price history | Step 2 |
| `GEMINI_API_KEY` | Analysts' summary | Step 6 |
