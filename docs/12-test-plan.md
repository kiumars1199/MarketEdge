# 12 · Test plan

## Unit (Vitest / pytest)
- Filters: URL round-trip (property test), `apply()` on fixture with 20 hand-checked cases, facets.
- Execution: TS port equals Python on `engine/tests/fixtures/book_expected.json`.
- Calculators: edge, ROI, Kelly (`f = (q−p)/(1−p)`), fee, odds conversions (¢ ↔ % ↔ decimal ↔ American).
- Journal P&L: win, loss, void, fees, CLV.
- Entitlements: free payload trimming (edge bands, row cap, delay).
- Engine: execution functions; model recovers perfect calibration on synthetic data; backtest never
  trains on rows with `ts >= fold start` (assert).

## E2E smoke flows (Playwright, against fixture data)
| ID | Flow |
|---|---|
| S1 | Land on `/` → "Open screener" → `/markets` shows rows and a freshness pill |
| S2 | Filter NFL + spreads + edge ≥ 2¢ → URL updates → reload keeps the view → reset clears it |
| S3 | Open a flag → drawer shows verdict, stake table, curve; custom stake $250 recomputes |
| S4 | Save preset "NFL edges" → switch away → apply it → identical rows; share link opens it in a new context |
| S5 | Star 2 markets → `/watchlist` shows them with "since saved"; unstar one |
| S6 | `/track-record` tiles equal `backtest.json`; `/tools` Kelly with q=0.6, p=0.5 → full Kelly 20% |
Paid additions: S7 sign up → upgrade (Stripe test) → gated features unlock; S8 create alert → run evaluator → inbox shows one event, second run doesn't duplicate.

## Data checks (run in the refresh workflow before publishing)
- `markets_scanned ≥ 1000`, tier-"best" flags ≤ 10% of markets (was 5%; raised Nov 17 when the 2-year history validated more categories), no NaN in any numeric field.
- Every flag: `edge ≥ min_edge`, `edge_low > 0`, `validated`, `execution` present.
- `scanned_at` newer than the previous publish.
Fail → keep the previous `live` data and open a GitHub issue.

## Launch checklist
- [ ] Disclaimer on every page + extension popup; Terms/Privacy pages live
- [ ] 18+ checkbox at signup; no "pick/lock/guaranteed" wording (grep)
- [ ] Kalshi data off unless written permission received
- [ ] Stripe live mode, webhook verified, portal configured, test purchase refunded
- [ ] Track record page includes limitations and the live ledger
- [ ] Alerts: unsubscribe link, quiet hours honored
- [ ] Error monitoring (Sentry) and uptime check on `/api/meta`
- [ ] Refresh workflow green for 48 h
