# 11 · Research: competitors and feature parity (Nov 16, 2026)

## Landscape
| Product | What it is | Price | Features worth matching |
|---|---|---|---|
| [Kalshi Pro markets table](https://kalshi.com/pro/help/markets-scanning-filtering-searching) | Kalshi's own live screener | free | category chips (multi), price ranges (last/yes bid/no bid), min size, min 24h $ volume, depth control (TOB…20¢), buying skew, expiry (hour/day/week), live-only, sortable/resizable columns, search incl. catalog |
| Polymarket site | venue | free | sort by 24h volume, liquidity, newest, ending soon, competitive; category sub-pages; live sports |
| [Oddpool](https://www.oddpool.com/pricing) | cross-venue data + arb scanner | free / $30 / $100 | cross-venue dashboards, arb scanner, whale tracking, portfolio page with P&L chart, API |
| PolyArb, Arbitrage Agent, ArbBets | arbitrage scanners/bots | $19–99/mo | real-time alerts (Telegram/Discord), latency |
| OutcomeEdge, Inside Edge, OddsIQ, Predly | model vs market mispricing | various | mispricing alerts, model probabilities |
| Hashdive / Unusual Whales, Polymarket Analytics, PolyAlertHub | wallet & whale analytics | free–$99 | smart scores, whale alerts, leaderboards, watchlists, notifications |
| Betmoar, TradeFox | trading terminals | — | advanced order types, portfolio analytics |
| OddsJam, SharpStack, OddsBandit (sports betting) | +EV scanners | $20–200/mo | **saved filters**, **bet tracker with CLV**, **calculators**, EV %, **Kelly sizing**, alerts by filter, **transparent results page** |
| Weather bots (WeatherBet, open-source) | forecast vs market | free / DIY | city coverage, forecast deltas — confirms weather markets are a known inefficiency |

## What traders expect (from the above)
1. Filters they can save and reuse (OddsJam "saved filters", Kalshi chips + ranges).
2. A results/track record page (SharpStack "Results", OddsJam CLV) — trust is the product.
3. Bet tracker with closing line value.
4. Kelly / stake sizing next to every opportunity.
5. Alerts by filter, on Telegram/Discord/email/push.
6. Liquidity truth: spread, size at best price, depth (Kalshi depth control). → our execution check.
7. Grouping by event and "closing soon"/"live" views.
8. Portfolio/P&L page that people want to open (Oddpool).

## Where Kismet is different
- Edge from **how markets like this actually resolved**, per niche, market type and time-to-close,
  instead of copying a sharp sportsbook (only works for sports) or showing raw odds.
- **Execution-aware**: every flag says whether the edge survives the spread at your stake.
- **Honest track record**: walk-forward backtest + live flag ledger, including where it fails.
- Works across categories (weather, soccer props, crypto daily) that sportsbook EV tools can't price.

## Gaps we chose not to fill in v1
Whale/wallet tracking, copy trading, order placement, arbitrage between venues (crowded, and
order placement adds regulatory weight). Revisit after launch.

## Polymarket revenue option (later)
Polymarket's Builder Program lets apps that route orders earn a builder fee on top of platform fees
([docs](https://docs.polymarket.com/programs/builders/fees.md)). Only relevant if we ever add order
placement, which v1 avoids.

## API facts used in the build
- Polymarket Gamma: `/events?closed=&tag_slug=&order=&end_date_min=` (100 per page), market fields
  `bestBid, bestAsk, volumeNum, volume24hr, liquidityNum, clobTokenIds, sportsMarketType, negRisk, gameStartTime`.
- Polymarket CLOB: `POST /books` (batch order books, public), `POST /batch-prices-history` (20 tokens),
  fees `rate × p × (1 − p)` by category ([docs](https://docs.polymarket.com/trading/fees.md)),
  WebSocket `wss://ws-subscriptions-clob.polymarket.com/ws/market` for live books (future: replace polling).
- Kalshi: `GET /markets` filters status/series/event/tickers/close-time ranges; no category on markets
  (category lives on series); `GET /search/tags_by_categories` for the topic tree. Commercial use needs
  written permission ([Developer Agreement](https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf)).
