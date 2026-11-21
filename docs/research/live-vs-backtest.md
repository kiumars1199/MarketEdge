# Live record vs walk-forward test (T-296, lane E)

Question (docs/OVERHAUL.md §E): the walk-forward test says best bets return about +17%; the live ledger says about −2%.
Why, and what filter would have brought live closer to the test?

Short answer: the gap is real, but it is **not** explained by entry prices, the lower-confidence tier, 90¢+
favourites, weather, or a lookahead we could find in the price data. On the very markets of the overlap week the
model claims ~87% wins where the price says ~79% and the outcome came out ~80%: the **model's win chances are too
high live**. Live is clearly below the test (about 7 standard errors), but not clearly below zero: it is one slate of
markets (179 events, almost all flagged on Nov 17), and its own t-stat is −0.96. The one filter that moved both the in-sample and the held-out rows the same way is a cap on
the predicted edge (`flag_max_edge = 0.10`); it is shipped off by default and it does **not** close the gap.

Re-run (§7, Nov 20 evening): the walk-forward test priced **at the real ask** instead of mid + half the spread, filters
chosen on older weeks and judged on the newest 8, every result **per event**. On a local, evenly sampled rebuild
(34,679 markets; production's data could not be rebuilt here) pricing at the ask changes almost nothing (mean charge
over the history price 12.0¢ vs 12.2¢; +1.9% vs +2.1% per bet, both t < 1); no filter chosen on older weeks holds up
on the newest weeks (23 events, −19% per event, t −0.8): too few to judge either way. Even sampling removes the
"87% of bets in the last two weeks" concentration (0.9%), which points at the sample, not the market; that cause is
**not confirmed** on production data (§5).

Everything below is reproducible with `scripts/ledger/*.py` (python3, standard library). Data: the `live` branch
(`git fetch origin live --depth=1`, commit `ecbc3a7`, published 2026-11-19 19:47 UTC) plus Polymarket's public Gamma and
CLOB APIs (read-only).

```bash
git show origin/live:ledger.jsonl > /tmp/l/ledger.jsonl        # also ledger_summary.json, backtest.json, flags.json, spreads.json
python3 scripts/ledger/analyze.py         /tmp/l/ledger.jsonl /tmp/l/ledger_summary.json /tmp/l/flags.json
python3 scripts/ledger/backtest_summary.py /tmp/l/backtest.json
python3 scripts/ledger/replay_prices.py   /tmp/l/ledger.jsonl /tmp/l/spreads.json /tmp/l/cache
python3 scripts/ledger/lookahead.py       /tmp/l/ledger.jsonl /tmp/l/spreads.json /tmp/l/cache
python3 scripts/ledger/stale_check.py     /tmp/l/ledger.jsonl /tmp/l/cache
python3 scripts/ledger/grade_now.py       /tmp/l/ledger.jsonl /tmp/l/ledger_now.jsonl /tmp/l/cache_now
python3 scripts/ledger/filters.py         /tmp/l/ledger_now.jsonl
python3 scripts/ledger/weather.py         /tmp/l/ledger.jsonl /tmp/l/ledger_now.jsonl
python3 scripts/ledger/split_check.py     /tmp/l/ledger.jsonl /tmp/l/ledger_now.jsonl   # §3 split, §4 summary fields
# §7: ask premium from the live ledger, an evenly sampled rebuild, then the fold report (mid vs ask, held-out, per event)
python3 scripts/ledger/calibrate_ask.py   /tmp/l/ledger.jsonl /tmp/l/cache /tmp/l/ask_premium.json
python3 pipeline/fetch_closed.py --days 240 --window-days 30 --per-window 150      # writes data/ (gitignored)
python3 pipeline/fetch_prices.py --extend --per-niche-month 300                    # run on an empty data/sample.jsonl
python3 scripts/ledger/fold_report.py config/demo.json /tmp/l/ask_premium.json --json /tmp/l/fold_report.json
```

## 1. Where the site's numbers come from, reconciled

- `/track-record` "Live record" reads `ledger_summary.json` (engine/ledger.py `summarize`); the return is
  `lib/proof.liveReturn` = Σpnl ÷ Σ(ask + fee), one $1 share per row, pnl = won − ask − fee.
- `live` branch snapshot: 2,687 logged rows, **862 settled rows**, 667 won / 195 lost, `avg_pnl` −0.0170 per share
  (the "−1.7%" in the brief is **−1.7¢ per share**), return **−2.14%** (the spec's "−2.2%"). Recomputed from the rows:
  identical (sports 315 rows −4.27¢ / −5.3%, weather 547 rows −0.21¢ / −0.3%).
- The spec's "1,117 settled" was an intermediate production snapshot (Supabase bucket, not in git). Grading the
  `live` rows again from Gamma today adds 149 settled rows (1,011 in total; **weather becomes 589, the spec's
  "590"**). Production at 2026-11-20 17:27 UTC shows 1,239 settled rows (956 won / 283 lost) at **−1.2%**. The
  numbers move every 10 minutes; the definitions above are what matter.
- **Rows are not bets.** `ledger.append` logs a market side again whenever it is re-flagged at a lower ask: of the
  862 settled rows only **593 are distinct bets** (269 re-flag rows). Counting each bet once: **−0.56¢, −0.7%**.
- **Rows are not independent.** All 862 settled rows were flagged on **one day (Nov 17)**, graded in one run, and
  come from **179 events** (63 games, 116 city-days of weather). Event-clustered t = −0.96: the live loss is not
  distinguishable from zero. The test's +10.9¢ per share (live-branch run) is ~7 standard errors above live, so
  "live is below the test" is a fair statement; "live loses money" is not yet.

## 2. Findings, one per question in §E

| Question | Answer | Numbers |
|---|---|---|
| Entries priced at the real ask after fees? | **Yes.** | Ledger `ask` = Gamma bestAsk; in the latest scan the CLOB book's best ask equals it for 98% of best bets (mean diff −0.02¢). Fee = rate × p × (1−p), same as the engine. |
| Does the test price at mid while live pays the ask? | **Yes, but the test charges for it, and the charge is not too small.** | Same 593 live bets, priced the test's way at flag time (history price + fee + max(0.5¢, ½ median live spread)): avg cost **80.67¢** vs live ask + fee **80.15¢**. Return at test pricing **−1.3%** vs live −0.7% (`lookahead.py`). The history price sat 2.2–3.0¢ under the ask. |
| Edge tier ("More bets") mixed into best bets? | **No.** | `scan.run` appends `best_flags` only. 67 settled rows had verdict "thin" (book edge < 2¢) at +1.3%; 3 "not worth it". 34 ledger ids show as tier "edge" in today's scan only because their price moved later. |
| 90¢+ favourites dominating? | **No.** | 206 of 862 rows (24%); avg win +7.2¢, avg loss −92.6¢; net **+1.83** of the −14.62 total loss (+1.2%). The losses sit at 50–90¢. |
| Which categories lose live? | **Sports, not weather.** | Sports 315 rows / 63 games: **−5.3%** (model 88% wins, actual 76%). Two soccer games, Wales–Portugal (−8.71) and Denmark–Norway (−4.89), are **93% of the whole loss**: 50 correlated rows, mostly Unders, on two high-scoring matches. Weather 547 rows / 116 city-days: **−0.3%** (+0.9% per distinct bet). |
| Weather break-out | Break-even; 90% of it is one bet type. | 589 settled rows / 375 distinct bets (with today's grading): −0.9% / −0.2%. "No" on an exact high-temperature bucket: 276 bets, −0.8%. By price: 90¢+ −2.3%, 80–90¢ +2.0%, 70–80¢ +1.7%, 60–70¢ +1.7%, under 60¢ −15.6% (20 bets). Model said 86% wins, actual 79%. In testing weather is the weaker category (+8.8% vs sports +20%). |
| Lookahead in the price data? | **None found.** | At flag time, history price − live ask is the same for winners (−2.24¢) and losers (−2.12¢): the price series does not know the outcome. Near close it moves toward the outcome (6 h: +12.5¢ gap, 1 h: +23.4¢), which is information arriving, at the same clock live uses: for 0 of 593 bets did the test's clock (closedTime first) differ from the live clock. On the overlap week's markets, history prices at each horizon win about as often as they cost (sports −6 to +4 pts, weather +3.5 pts; `stale_check.py`). |
| Lookahead in the test code? | **Two mild ones, not quantifiable without `data/`.** | (a) A fold trains on markets that *resolved* before the fold starts, but a 72 h/168 h test bet was *placed* up to 7 days earlier, so training includes up to a week of outcomes after the bet. The test's 72 h/168 h bets are its best (+18%/+20%, 94–95% won at ~76¢) and live has almost none (15 rows at 72 h, 0 at 168 h). (b) The half-life is chosen by the best t-stat over the same test folds (21 d: +8.4%, 90 d: +13.9%). Both inflate the test; neither touches live. The per-bet test rows are not stored and `data/` lives only in the Actions cache, so we could not re-run. |
| Is the big negative May week a data bug? | **Not proven: left as is.** | Live-branch run: week of May 3, 19 bets in 19 events, won 13 at an average price of 87¢, −23%. P(≤13 of 19 at 87%) = 2.9%; across 42 weeks with bets one such week is expected. Production run: Apr 29 (8 bets, −35%) and May 6 (1 bet, −100%). Fold rows are not stored, so no row-level bug can be shown. |

### Also found

- **The "1 year" test is mostly two weeks.** Live-branch run: 14,615 of 16,896 test best bets (86.5%) are in the last
  two weeks (Nov 1–14); production: 26.5K of 30.5K (87%), none before Apr 22. The earlier weeks still return +12.3%
  over 2,281 bets (32 of 40 weeks up), so the result is not *only* the last two weeks, but "Testing on 1 year of past
  markets" overstated the span (lib/proof `testSpan` multiplied folds by days). **Fixed** (lane E now owns
  `lib/proof.ts`): the span comes from `folds[]`, see §8.
- **The model is too sure, live.** Predicted win rate 86.6% vs actual 77.4% on all settled rows; sports 88.4% vs
  75.9%. Flags the model rated highest did worst live: predicted edge 2–5¢ −1.6%, 5–10¢ −1.8%, 10–15¢ −3.6%, 15¢+
  −4.1%. In the production test the edge buckets earned +13.1¢, +14.0¢, +10.2¢, +16.9¢: higher rating did not
  consistently earn more, so `/track-record` should **not** say "Bets we rated higher did better" on that data.
- **"Needs ~39 settled bets to judge" was too optimistic.** `lib/proof.betsNeeded` scaled the test's t-stat (56.3)
  as if live bets were independent; they arrive in correlated slates (179 events, one day). **Fixed**: replaced by
  `eventsNeeded` (test events × (2 ÷ t)²), judged on settled US events, see §8.

## 3. The filter

Candidates came from the brief's hypotheses (an edge cap, one bet per event, a 60¢ price floor, weather only), but
they were **not** pre-registered: the in-sample edge-band table had been seen before the cap was picked. Held-out
split: **in-sample** = the 862 rows the published snapshot had graded (flagged Nov 17); **held-out** = the 149 rows
graded since by `grade_now.py` (settled Nov 19–20), not looked at while choosing. The held-out rows are close to
independent of the in-sample ones: 146 of 149 were flagged on Nov 19, and only 1 of their 30 events also appears
in-sample (107 sports rows, 42 weather). Month-based splits are impossible: the live ledger starts Nov 17.

| Rule | In-sample (rows) | Held-out (rows) | Both, distinct bets |
|---|---|---|---|
| As live (cap off) | 862 rows, 179 events, **−2.1%** | 149 rows, 30 events, **+9.6%** | 742 bets, **+1.3%** |
| `flag_max_edge = 0.10` (cap on) | 655 rows, **−1.7%** | 111 rows, **+12.6%** | 574 bets, **+1.9%** |
| One bet per event | 394 rows, −1.6% | 30 rows, +4.5% | — |
| Price ≥ 60¢ | 812 rows, −1.2% | 138 rows, +5.9% | — |
| Weather only | 547 rows, −0.3% | 42 rows, −9.0% | — |

- The edge cap is the only rule that improved **both** splits. Its in-sample sweep is not monotonic (4¢ −3.4%,
  8¢ −2.4%, 10¢ −0.5%, 12¢ −0.3%, none −0.7%, distinct bets), so 10¢ is chosen from the test's own bucket boundary
  and the scanner's existing "edge looks too good" warning, not from the ledger. Treat the in-sample gain as noise-sized.
- The held-out rows flip sign (+9.6% vs −2.1%) with no filter at all: 30 events decide them. **No filter fitted
  on this ledger can be trusted to close a 15-point gap**, and none does: with the cap on, live is still far below
  the test's +17%.
- In the test the cap barely matters (10–15¢ bucket earned +10.2¢, the rest +13–17¢), so turning it on is
  expected to cost little test return.

**Shipped:** `flag_max_edge` in `config/demo.json` (`null` = off, the default). When set, `engine/scan.is_best`
(the live Best-bet rule) and `engine/backtest.flag_mask` (the test) both require predicted edge < cap, so live and test
keep one rule. Tests: `engine/tests/test_max_edge.py` (off by default, cap boundary, other rules unchanged, backtest
parity, shipped config off).

## 4. The US record (§G)

`ledger_summary.us` (merged from `claude/us-venue`) is **empty on every row logged so far**: no ledger row before
the US venue shipped carries `us_ask`, so there is no US live result yet, at any price. The nearest proxy is the
sports part of the live record (Polymarket US lists only sports): 315 settled rows / 63 games at **−5.3%** at
international prices, before US's ~0.6¢ higher fee. `/track-record` therefore leads with an empty US card that says
so, then the whole record.

Two caveats for the new summary fields, both in `engine/ledger.py` (not lane E's file):
- `events` groups by `event_id`, which no row logged so far has (0 of 2,687), so each old market counts as its own
  event: `first` shows **739 events for 742 bets** where `event_key` finds 208 (179 in-sample). Mixed with new rows
  the count stays inflated, so the page takes events, and the "enough to compare" call, from the US record only
  (every row with a US price is written by the new code, which logs `event_id`). With no settled US bets the page
  makes no call. Fix at the source: derive `event_id` for old rows (Gamma event id, or `common.event_key`).
- On the test's numbers "enough" comes early: test events × (2 ÷ t)² is ~10 events on the live-branch run (2,871
  events, t 34.7) and 17 on the fixture, so the US record will read "enough to compare" after its first ten-odd games.
  The t is event-clustered, so the formula is sound, but t 34.7 comes from the run with 86% of its bets in the last 2
  weeks. On the evenly sampled rebuild (§7: 214 events, t 0.80) the same formula gives ~1,340 events, and the return
  it would have to confirm is +0.9% per event, not +14%. **Owner decision:** publish a backtest without the
  concentration (§5) before trusting the ~10 bar, or raise the bar by hand.
- `intl_only` is every old row (742 of 742), not "bets US users couldn't place". The page shows the
  international-only line only once some US rows exist.
- `vs_same_payout` ("Kismet's picks vs other bets at the same payout"): `others` are the random same-payout bets from
  `output/control.jsonl`, logged with `event_id`, so their events are real. `picks` is `first_rows(entries)`: **every
  pick since the ledger began**, including the rows logged before the control log existed, and counted by `id` where
  `event_id` is missing. So the two sides cover different periods and the picks' event count is inflated. Fix at the
  source (engine/ledger.py, not lane E's file): pair each control bet with its own `pick_id` and aggregate only those
  picks. Until then the page shows the others' events only, and claims no difference until the others reach the same
  events bar as the proof line. No summary has `vs_same_payout` yet (no `control.jsonl` exists on any branch I can
  read), so the card does not render on today's data.

## 5. Why the test history is thin before September (§G3)

Production's run has 87% of test best bets in its last two weeks and none before Apr 22. Two causes, measured on a
local rebuild (§7), not on production's `data/` (it lives only in the Actions cache: 1,738,882 bets, 340,380
markets, too big to rebuild here):

1. **The sample is dense at the end.** The bootstrap takes the **newest 2,000 closed events per tag**
   (`fetch_closed.py` defaults) and `engine/update.py` then adds **every** newly closed market, uncapped, on each
   refresh. Sports and weather close hundreds of events a day, so recent weeks get everything and older weeks only
   what the backfill reached. Gamma itself is not thin: in a windowed backfill at a fixed 150 events per tag per 30
   days, Apr–Aug still return 20–30K markets a month (Sep–Nov 68–88K: Polymarket listed more markets). The CLOB price
   history is not thin either: once sampled evenly (≤ 300 markets per niche-month), 60–67% of markets in every month
   from Apr to Nov get a usable snapshot, older months included.
2. **The model needs a few dense weeks before it flags anything.** On the rebuild, folds before Apr 29 have up to
   7,902 test bets each and **zero** best bets: a node needs `min_node_events` 25 and a pessimistic edge above the
   cost, which a thin training set cannot give. The first flagged week (Apr 29) comes five weeks after the rebuild's
   data turns dense (Mar 25); production's first (Apr 22) fits the same pattern if its own dense data starts in
   March.

With an even sample, the concentration disappears: **0.9%** of the rebuild's best bets are in its last two weeks
(production 87%). That is consistent with cause 1 but **does not confirm it**: the rebuild has 432 best bets, not
30.5K, and its last weeks have almost none (0 in 3 of the last 4 weeks, despite 1.3–7.7K test bets each), so it
cannot show what production's last two weeks would look like with a capped sample. What would settle it: test bets
per fold on production's data (backtest.json stores flags per fold, not test bets). **Owner action**: run the
backfill to completion in `refresh.yml` (`mode=backfill`, then `fetch_prices --extend`), cap `engine/update.py`'s
additions per niche-month the same way, and re-run `python -m engine backtest`; then compare `folds[].flags` with
today's. Until then the site states the span it has: "past markets from Apr 22 to Nov 14, 87% of bets in the last 2
weeks" (production) instead of "1 year".

## 6. What would actually tell us more

1. Count the live record by distinct bet and by event (`first`, `events`; fill `event_id` for old rows).
2. Store per-bet test rows (id, horizon, price, model chance, result) for the last folds, so the overlap week can be
   compared bet for bet with the ledger.
3. Embargo the training cutoff by the horizon (train on markets resolved before `fold start − 7 days`) and re-run;
   if 72 h/168 h returns fall, (a) above was doing the work.
4. Wait for weeks, not days, of live results before judging; report them by event.
5. Store test bets per fold (not just flags) in `backtest.json`, so the sample density behind each week is visible.

## 7. Re-run: the test at the ask, filters held out, results per event

**Data.** A local rebuild, not production: `fetch_closed.py --days 240 --window-days 30 --per-window 150`
(355,488 resolved markets, end dates Mar 25–Nov 20, 2026), then `fetch_prices.py --extend --per-niche-month 300`:
**34,679 markets, 195,466 bets, 10,733 events** (sports 52K bets, finance 11K, politics 9K, geopolitics 9K, tech 7K,
culture 5K, weather 3.7K, crypto 0.6K). Production has 1.74M bets. Same config (`config/demo.json`), same 52 weekly
folds, one half-life (90 days, production's choice). Script: `scripts/ledger/fold_report.py`.

**Ask pricing.** `calibrate_ask.py` measures, on the 593 settled live bets, what the real ask paid over the CLOB
history price the test uses, at the moment of flagging: median **+1.05¢** (mean +2.21¢); sports +1.0¢, weather
+1.5¢; per niche|market type only soccer moneyline (+0.5¢, 25 bets), soccer props (+1.0¢, 114), soccer totals
(+1.5¢, 65) and weather multi-outcome (+1.5¢, 330) have 20+ bets. New backtest option `"taker_price": "ask"` (config,
default `"mid"`, unchanged behaviour) charges that premium where a niche|market type is calibrated and keeps the
half-spread charge elsewhere (`engine/backtest.slippage`, `engine/tests/test_ask_price.py`). Caveat: the premium is
measured only on bets the live rule flagged, which fire where the ask sits close to the price, so it is **biased
low**; the mean-premium run below is the sensitivity check.

**(1) Mid vs ask, all folds, each event once.**

| Pricing | Mean charge over history price | Best bets | Events | Return per bet | Return per event | t (event-clustered) |
|---|---|---|---|---|---|---|
| Mid + ½ live spread (today) | 12.21¢ | 432 | 214 | +2.1% | +0.9% | 0.80 |
| Ask, median premium | 12.02¢ | 474 | 237 | +1.9% | +1.9% | 0.71 |
| Ask, mean premium | 12.10¢ | 463 | 231 | +2.8% | +2.5% | 1.07 |

Half the median live spread is already a bigger charge than live asks paid over the history price wherever both are
known (e.g. soccer totals: half spread vs +1.5¢), so pricing at the ask makes the test slightly *cheaper*, not
dearer. Only groups with 20+ graded live asks are calibrated (soccer moneyline, props and totals; weather
multi-outcome). Every other group keeps the half spread (the `cat:` premium only where no spread is known), so most test bets are priced
the same in both runs: moving the premium from the median (+1.05¢) to the mean (+2.21¢) moves the mean charge by only
0.08¢. This re-run tests the ask where live asks exist, not across the board. **The mid-vs-ask question does not explain the live gap**, which agrees with §2 (same live bets: test-style
cost 80.67¢ vs live 80.15¢). Per fold (week of, mid → ask): Apr 29 +27.4% → +27.6% (10 events), May 20 +2.4% → +7.7%
(40 → 46), Jun 10 +8.2% → +8.2% (41), Jun 17 −3.4% → −5.0% (38 → 40), Jul 22 +4.2% → +8.5% (9 → 23), Sep 16 +4.5% →
−5.1% (9 → 10); every other week is identical at both pricings or has under 10 events. Full table in
`fold_report.json` (`folds[]`).

**(2) Filters chosen on older folds (Nov 19, 2025–Sep 16, 2026), reported on the newest 8 (Sep 23–Nov 11).**
Candidates: categories with a positive per-event return on older folds (30+ events), time-to-close likewise,
"validated" (the live rule: ≥ 100 flags, profit, t ≥ 2, per category and per horizon, computed on older folds only),
and the 10¢ edge cap, alone and combined. Chosen = best per-event return on older folds with 100+ events.

| Pricing | Chosen on older folds | Older: events, return/event | Newest 8 weeks: events, return/event, return/bet, t |
|---|---|---|---|
| Ask (median) | no filter | 214, +4.1% | 23, **−19.1%**, −9.8%, −0.81 |
| Ask (mean) | time-to-close (72 h, 168 h) | 172, +4.9% | 17, −22.0%, −8.1%, −0.54 |
| Mid | edge cap 10¢ | 136, +3.6% | 18, −15.2%, −4.0%, −0.31 |

- **"Validated" selects nothing**: no category and horizon reach ≥ 100 flags with t ≥ 2 on the older folds of this
  sample, so the live rule would show no best bets at all on it.
- Nothing chosen on older folds carries over: every candidate is negative on the newest weeks, but on 8–23 events
  with |t| < 2. **Too few to judge.** The newest weeks have few best bets because the model flags little there
  (0 in 3 of the last 4 weeks), not because they were left out.

**(3) Per event, not per bet.** All tables above count each event once (its bets averaged). Over all folds the
two views agree within ~1 point (ask: +1.9% per bet, +1.9% per event; mid: +2.1% vs +0.9%); 73% of events made
money at either pricing.

## 8. What the site says now (`lib/proof.ts`, before → after)

`/pricing`, `/about`, `llms.txt`, `/api/backtest`, the MCP `track_record` tool and `/track-record` all print
`siteProof`. On the live-branch data (Nov 20):

- Before: "Testing on 1 year of past markets: best bets, +14% per bet. Live since Nov 17: 742 settled bets, +1.3%,
  enough to compare with testing." (production: "+17%"). "1 year" was folds × 7 days; "enough" compared 742 bets
  with a bets threshold of 56, as if bets were independent.
- After: "In testing on past markets from Nov 30, 2025 to Nov 14, 2026, 86% of bets in the last 2 weeks: best bets,
  +14% per bet. Live since Nov 17: 742 settled bets, +1.3%." The span is the first to the last week with best bets
  (`folds[]`); "enough to compare" / "still too few (needs ~N events)" appears only once US bets settle, judged on
  their events: test events × (2 ÷ t)² = 2,871 × (2 ÷ 34.7)² ≈ **10 events** on this run, 17 on the fixture.
- `/track-record` leads with the Polymarket US record (settled bets, events, return), then the whole record (each
  bet once) with "Including international-only bets US users couldn't place: N (mostly weather)" once US rows
  exist, and "Kismet's picks vs other bets at the same payout" beside the US record when `vs_same_payout` exists
  (events counted on the same-payout side; see §4 for why not on the picks side).
