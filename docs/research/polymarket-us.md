# Polymarket US: can US users act on our bets? (Nov 20, 2026)

Short answer: today, mostly no. Kismet scans and grades **international** Polymarket, which US residents can't
trade on. US users trade on **Polymarket US** (CFTC-regulated, KYC, fiat). Only about a quarter of what we scan
is listed there, all of it sports. Our live record is 53% weather bets, and Polymarket US has no weather markets.

This branch adds the US venue to the engine (`pipeline/venue_us.py`, `engine/scan.py`, `engine/ledger.py`). Every
scanned bet now carries its Polymarket US price and fee when it's listed there, and the live record grades
US-listed bets separately at US prices. The numbers below were measured on Nov 20, 2026 around 12:30 ET.

## 1. Two venues
| | International (polymarket.com) | Polymarket US (polymarket.us) |
|---|---|---|
| Who can trade | Not US residents (US order placement is geoblocked) | US residents, after KYC |
| Money | USDC on Polygon | Card, ACH, Apple Pay, PayPal, Venmo, USDC, wire |
| Market data API | gamma-api / clob.polymarket.com | `https://gateway.polymarket.us` (public, no key) |
| Taker fee | `rate × p(1−p)`, rate 0–0.07 by category (what the engine uses) | `Θ × p(1−p)`, Θ = **0.095** below $10k 30-day volume, 0.0695 in an account's first 7 days (schedule effective Nov 14, 2026) |
| Weather markets | Yes (1,539 open in our scan) | Essentially none (11 "climate" markets) |

Sources: docs.polymarket.us (Introduction, Fee Schedule, Rate Limits, Markets API), docs.polymarket.com.
The handoff says Polymarket US isn't available in Nevada and Utah. I didn't re-verify that; check it before we say
it on the site.

## 2. The public US API (what the engine uses)
- `GET https://gateway.polymarket.us/v1/markets?limit=500&offset=N&active=true&closed=false`. Each market carries
  `slug`, `question`, `outcomes`, `bestBidQuote`, `bestAskQuote`, `feeCoefficient` and `status`. One paginated
  pull (~165 requests for ~82k markets, ~30–60 s) prices the whole venue. No per-market calls are needed.
- `GET /v1/markets/{slug}/book` (full book), `/bbo`, and `/settlement` (1.0 / 0.0 for the first outcome).
- Rate limit: 25 requests/s per IP.
- Buying the first outcome costs `bestAsk`. Buying the second outcome costs `1 − bestBid` (one instrument per
  market, long or short).

## 3. What's listed (open, binary, Nov 20)
~82,000 markets: about 80% sports, plus politics (~4,200), culture (~2,500), crypto (~1,100), macro (~540),
tech (~230), geopolitics (~200) and finance (~130).

## 4. How much of our scan is on US
Scan universe = what `engine/scan.py` fetches, closing in 0.5 h–10 days (the window the model scores).

| | Markets | On Polymarket US |
|---|---|---|
| All | 24,937 | **6,775 (27%)** |
| Sports main lines (moneyline, spreads, totals, team totals) | 14,302 | 6,273 matched; 1,125 rejected by the price check (mostly empty international books); 4,463 lines not listed on US; 2,441 in games not listed on US (yet) |
| Politics, culture, crypto, finance, tech, geopolitics, weather | ~18,000 | **0** |

Non-sports don't match because the contracts differ, not because of the matcher. For example, international
"ETH above $1,500 on Nov 26 (noon ET)" vs US "ETH price at 5:00 PM ET Fri". Same topic, different bet.

By league, of all scanned markets including props: ncaab 56%, cfb 32%, nba 21%, nfl 20%, ufc 17%, soccer 7%,
nhl 7%. Tennis, esports and cricket are about 0%.

**Matching accuracy.** On 6,002 matched markets with live books, the US mid minus the international mid had a
median of **0.5¢**. 86% were within 3¢ and the 90th percentile was 4¢. A reversed team or wrong line would show a
gap of tens of cents, so the matches are the same bets.

## 5. What a US user pays for the same bet
Across 7,081 matched sides priced 5–95¢ (spread ≤ 5¢), the US cost per $1 share (ask + fee) minus the
international cost (ask + fee) was:
- median **+0.58¢** (mean +0.56¢); the fee alone is +0.95¢ and US prices are slightly better
- US cheaper on 23% of sides
- by league: nba +1.0¢, soccer +1.1¢, cfb +0.6¢, nhl +0.5¢, nfl +0.3¢, ncaab +0.2¢

Best bets need a 2¢ edge, so about a quarter to a third of the edge goes to US costs. Thin edges (2–3¢) often
won't survive on US. The new `us.edge` field shows that bet by bet.

## 6. Problems this exposes in the live record
1. **Mix.** Of 1,117 settled live best bets, 590 (53%) are weather, which US users can't place. 524 are sports.
   The −2.2% live number isn't a US user's experience either way.
2. **Clustering.** All 1,117 settled in the 3 days since Nov 17, and many share a game or a weather day. The site
   says "enough to compare with testing" using bet count (`needs ≈ 39`). With correlated bets, the honest sample is
   the number of events, which is much smaller. The new `events` and `avg_pnl_by_event` fields in
   `ledger_summary.json` give it.
3. **Double counting.** The ledger adds a new row whenever a market is re-flagged at a better ask, so one bet can
   count 2–5 times. The new `first` block counts each market and side once.
4. **Backtest concentration (lane E).** /track-record says "Testing on 1 year of past markets", but 26.5K of the
   30.5K tested best bets (87%) fall in the last two test weeks (Nov 4 and Nov 11), and no week before Apr 22 has
   any. The +17% is mostly two weeks of data, not a year.

## 7. What the code does now (this branch)
- `pipeline/venue_us.py`:
  - pulls every open US market
  - matches international sports markets to their US twins (same game key; moneyline, full-game and period
    spreads, totals and team totals, with each league's slug spelling)
  - orients outcomes by team or Over/Under
  - checks that a US spread's subject team matches
  - rejects any match whose prices differ by more than 12¢
- `engine/scan.py`: every scanned market gets `market_slug` and `us` (US slug, link, side, ask, fee,
  edge, roi at US prices, or null). `meta.us` reports coverage: `markets`, `matched`, `best_on_us`, and
  `best_us_edge` (Best bets still ≥ 2¢ at US prices). A US outage leaves `us` null and the scan runs on.
- `engine/ledger.py`: new rows store `event_id` and the US price. The grader settles US rows from Polymarket US's
  own settlement when published (else the international result) and books `us_pnl`. `ledger_summary.json` gains:
  - `first`: each market and side once
  - `us`: the US-tradable live record, by category
  - `intl_only`
  - `roi_pct`, `events` and `avg_pnl_by_event` on every block
- Web: `types.ts` and `docs/03` updated. Free users see the US link and price, but not the exact US edge or return
  (`lib/data/gate.ts`).
- Tests: `engine/tests/test_venue_us.py` (16 tests), `apps/web/test/us-gate.test.ts`.

- Same-payout comparison: every new pick also logs one random other bet at the same payout band (same category
  when possible) to `output/control.jsonl`. It's graded the same way, and `ledger_summary.vs_same_payout` shows
  picks vs others per band. This measures the honest pitch ("the best pick at the multiplier you already want").

The US record starts the first scan after deploy. Earlier rows have no US price and stay in `intl_only`.

## 8. Not done here (spec in docs/OVERHAUL.md §G)
- UI: venue badge, a "Bet on Polymarket US" button with the US price, and a hidden or relabeled international
  button for US users.
- /track-record: show the US record first, with events as the sample size.
- A US-native scan for politics, culture, crypto and macro, which don't match international contracts.
- Make the record mostly US and spread out (§G).
- Verified 2026-11-20 (T-307, docs/overhaul-evidence/G): `https://polymarket.us/market/<slug>` does NOT open the market (307 to the home page on desktop, to the app-install link on iPhone). Links use `https://polymarket.us/event/<event slug>` (sports events redirect to `/sports/<league>/<slug>`).
