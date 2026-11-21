# 18 · Bigger multipliers, more bets with an edge, combos

Owner request (Nov 16, 11:38 PM). Facts from the current data (Nov 16 scan):
- All 624 Best bets pay under 2x. Bets with any positive edge after fees, by payout:
  under 2x 4,519 · 2–3x 4 · 3–5x 11 · 5–10x 3 · 10x+ 160 (mostly under 5¢, below today's price floor).
- History says long shots are usually **overpriced** (favorite-longshot bias), so loosening rules will add some
  high-multiplier bets, not a flood. The UI must say this plainly, not hide it.
- The headline "9,666 tested bets" comes from only 12 weekly test folds. The data set already holds
  778,152 resolved bets over a year, so a longer test is mostly a config change.

## 1. More history (engine, Lane A)
- `walk_forward.folds` 12 → 52 (one year of weekly folds). Keep the half-life grid. Report total tested bets.
- Backfill: run `pipeline/fetch_closed.py --days 730` and `fetch_prices` (resumable) so the model and test cover
  two years where Gamma has the history; keep `settle_days`. Note in STATUS.md how many bets it reached.
  T-278 lifted the `fetch_closed` caps: `--per-tag` / `--per-window` above Gamma's offset limit (~2000) now work (the
  busy window is split, never paged deeper), `0` means every event, rows stream to disk page by page (memory stays
  flat), `--pause` (0.1 s) spaces Gamma pages. The checkpoint records each (window, tag)'s cap, so rerunning with a
  bigger `--per-window` tops up windows fetched at a smaller one (pre-T-278 checkpoints count as 200). The
  `mode=backfill` workflow now runs `--days 730 --window-days 30 --per-window 1000`. How much of it reaches the model
  is still capped downstream by `fetch_prices --extend --per-niche-month` (default 1500 per niche per month).
- New backtest breakdown `by_pays`: bands `<1.5x, 1.5–2x, 2–3x, 3–5x, 5–10x, 10x+` with bets, hit rate,
  predicted vs. actual hit rate, ROI, t-stat, for both tiers below. This is what decides whether long shots are real.
- Lower `price_min` to 0.03 (≈33x) for the second tier only; Best bets keep 0.05.

## 2. Two tiers of bets
| Tier | Rule | Where it shows |
|---|---|---|
| **Best bets** | unchanged: edge ≥ 2¢ after fee and ask, `edge_low > 0`, validated category + horizon | top of `/`, default |
| **More bets with an edge** | edge after fee and ask ≥ 2¢ (any payout), model node has ≥ 40 effective samples, live book exists | section under Best bets, and in All markets |
Second-tier cards show a muted "Lower confidence" label, the sample size, and, from `by_pays`, how that payout
band did in testing ("Bets like this: won 14% of the time, +6% return in testing" or "lost money in testing").
Example that must show up: pays 10x (10¢), our chance 14%, so it's in the second tier, near the bottom by default.
Engine: add `tier: "best" | "edge"` to each flag (docs/03 + `lib/types.ts` in the same commit). The data
checks in docs/12 apply the 5% cap to tier "best" only.

## 3. Multipliers first-class
- **Pays** pill (docs/13) filters both tiers: Any · Under 1.5x · 1.5–2x · 2–3x · 3–5x · 5–10x · 10x+.
  Choosing 3x+ lifts the 40% chance floor (docs/13 already does this).
- New sort **"Biggest payout"** (pays desc, edge ≥ 2¢ only) next to "Best return". Default on Best bets stays
  "Best return", which already favors higher payouts because return = edge ÷ price.
- Quick chip row on Best bets: "2x+", "5x+", "10x+" (one click each).
- Search: "10x", "long shots", "+900" already parse to pays ranges (docs/13); they must hit both tiers.

## 4. Clean numbers
`formatCount(n)` used for every count shown to users (bets, markets, events):
under 1,000 exact; otherwise **round down** to one decimal, dropping a trailing ".0" (T-288): 1,000 → "1K", 9,666 → "9.6K", 12,340 → "12.3K", 16,896 → "16.8K", 778,152 → "778.1K",
1,240,000 → "1.2M". Hover shows the exact number. Never round up: "10K+" only when the real number is ≥ 10,000.
Unit test the edges (999, 1,000, 9,999, 10,000, 999,999).

## 5. Combos (parlays)
How combos work at each venue:
- **Kalshi Combos**: one contract that pays $1 if every leg wins. Price comes from Kalshi's market makers.
  API: `GET /multivariate_event_collections`, `POST /multivariate_event_collections/{ticker}/lookup` (find the
  combo market for chosen legs), `GET /events/multivariate`, then a normal order on the combo market.
- **Polymarket**: no single combo contract. A "combo" there is just the legs bought separately.

The math (legs from **different events only**; same-event legs are correlated and the simple product is wrong):
- Combo chance `Q = Π q_i` (our chance per leg). Payout `= 1 / combo price`.
- Kalshi combo: `edge = Q_low − combo_ask − fee(combo_ask)`. Use Kalshi's quote.
- Without a combo quote: show the "fair combo price" `Π (ask_i + fee_i)` and its return `Q_low / price − 1`.
  **One chance on screen (Marc #15/#74, Nov 21):** the return, "wins about" and each leg's "N% chance to win" all use
  the cautious chance, so the return is positive exactly when the combo beats its price. `Q` is in the details.
- When every leg has an edge and the legs are independent, the combo has an edge too, and its return is bigger.
  But its chance of winning drops fast, and model errors multiply: if each of 3 legs is 2 points too optimistic,
  the combo can flip from +20% to negative. Show a "Combo confidence" that uses each leg's low estimate:
  `Q_low = Π q_low_i`; the combo counts as having an edge only if `Q_low` still beats the price.
- **A combo can only have an edge when a leg doesn't** if the venue prices it below the product of the leg prices
  (Kalshi market-maker quotes sometimes do), or when legs are correlated and the venue ignores it. Show this
  only for Kalshi combos with a live quote, and only between different events.

What we build:
1. **Combo builder** (drawer → "Add to combo"; a tray at the bottom of the screen, 2–6 legs). It shows combo
   chance, pays Nx, return and whether it beats the price. It is the user's own calculator: they pick the legs. It
   refuses a leg from an event (by event id) already in the combo, a closed market, and a market whose title names a
   day that is over everywhere (UTC−12); saved legs that closed or went past-dated leave the tray with a note.
2. **Suggested combos** on Best bets: the same for everyone, built from tier-"best" bets on different events
   that close within 24 h of the request (never a past-dated title): the top 5 two-leg and three-leg combos by return whose `Q_low` still beats the price.
   Label "Combo · 3 legs · pays 4.1x · wins about 1 in 3".
3. **Kalshi combo check** (behind the docs/16 Kalshi data permission; off by default): when legs map to Kalshi
   markets, look up the combo quote and show the true edge.
4. **Backtest combos** (Lane A): from historical tier-"best" bets, build random 2- and 3-leg combos across
   different events that closed the same day; report hit rate, predicted vs actual, ROI and t-stat in
   `backtest.json → combos`. The suggested-combos panel shows this record and hides itself if combos lost money
   in testing.
5. Paper trading (docs/16) can place a Kalshi combo order on the demo exchange; Polymarket combos open each leg's page.

Copy rules: never call a combo "safe"; always show "wins about 1 in N"; no "lock" or "guaranteed".
Tests: combo math (independent legs, fee, `Q_low`), same-event warning, formatCount, tier assignment,
`by_pays` and combo backtest never using rows at or after the fold start.

## 6. Framing for people placing one or two bets (owner note, 11:42 PM)
Users aren't high-volume traders; most place a bet or two. Long-run averages mean little to them. So:
- Every card leads with **what happens on this one bet**: "Pays 10x · wins about 1 in 7", then the edge as
  "better price than usual" (+4 pts). Return % moves under it, smaller.
- Long shots and combos get their own visible rows on Best bets ("Big payouts", "Combos"), not only the bottom
  of the list, because that's what casual bettors come for. They keep the "lower confidence" label.
- One plain line in the drawer for anything under 25% chance: "Most of the time this loses. The edge means
  you're getting a better price than usual, not that it will hit."
