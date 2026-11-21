# Marc's QA list (Nov 20, 2026): Lane B log

Lane B: one return figure per bet, edge labels, payout-band records, FAQ, backtest vs live, /about Top 3, ledger.
Q was away. Where the brief left a choice, the reading taken is written next to the item.

## Group 1: one return figure (`claude/qa-b-return`, "QA-B: 55, 31, 20, 37, 54, 5, 14, 51, 28")

Core decision: a card shows ONE return figure, the estimated return after the fee at the card's price
(`roi_pct` = win chance × payout after fee − 1). "Why this bet?" shows the same number, then "Similar past bets
in testing" and "Live record so far", each with its count.

| item | status | evidence |
|---|---|---|
| 55, 31, 20, 37, 54 (card, drawer, table, "If you bet now" disagree) | fixed (not verified live) | `lib/betFigures.ts` `betQuote()` is the one source for venue, price, fee, payout after fee (`pays` number + `paysText`), return (`retText`, band on Free) and the arithmetic line. BetCard, Why, MarketDetail, MarketCard, MarketTable, dashboard panels and the MCP server all read it. One payout per bet, after the fee; the stake box is $10 × that payout. `test/one-return.test.tsx`: every fixture best bet, exact and Free, card = Why = compact card = stake box, and the shown return = shown chance × shown payout − 1 to print rounding (Free: the formula over the 5% chance floor reaches the band). |
| (main's note 2) Free must not leak the exact return | done | `why-math` ("90% × 1.39x − 1 ≈ +25%") only renders when the quote is exact; Free sees "Free shows a range." Asserted for every fixture bet in `one-return.test.tsx`. |
| (main's note 3) n next to each drawer figure | done | Estimated return: "Based on about N similar past bets". Testing: "N tested bets, won Y%". Live: "N settled best bets", or "No settled bets yet" when 0. |
| (main's note 4) 7 slots at 390px | done | Return sits inside the existing value slot (stars + "+25% est. return"). New e2e `overhaul-cards.spec.ts` "390×844: one return figure in the value slot, 7 slots, nothing overflows". |
| 5 (edge labels don't match their numbers) | fixed | Verdict, "pts" and chance are now computed from the side at the quote's price (`atQuote`), so a US card's label and number come from the same US price. `gapPts` adapts precision so a positive gap never prints "0 pts" and zero prints unsigned; `gapRange` returns the floored gap when ranges don't overlap. Unit tests in `test/bet-figures.test.tsx`. |
| 14, 51 (one tested figure per payout band) | fixed | Why's "Similar past bets in testing" reads `backtest.by_pays` (the same source as /track-record "By payout"). Under 30 tested bets it says "too few tested bets to show a return (N tested bets)" instead of a number (`TESTED_MIN`, `bandTested`). The older "similar past bets" line from `realistic_edge` was removed, so there is one tested figure. |
| 28 (/about Top 3) | fixed | `lib/topBets.ts` ranks by the shown return (`betFigures(...).ret.roi`, venue-aware); /about renders the real `BetCard` ($10 stake, one return, same wording) instead of its own preview card. |
| 69 (Biggest payout sort) | handed to Lane A | `BetQuote.pays` (a number, after the fee) is exported for A's sort. No sort logic changed here. |

Gates: typecheck, lint clean; full chromium e2e 79 passed, 1 failed (trading-paper: `apps/extension` has no node_modules in this container, so its `pnpm build` fails; the branch does not touch the extension). s6.spec "landing (/about)" updated for the BetCard Top 3; vitest all green except `test/teaser.test.ts` "one bet per game" (fails identically
on origin/final 67faeaf; date-dependent Free sample, Lane A area); `pnpm build` OK; `pnpm check:js` 149.4 kB
(budget 150); e2e multipliers, overhaul-cards, proof, s3-drawer, a11y: 49 passed (chromium, port 3102,
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` because Playwright 1.65.1's own build is
not downloaded in this container).

Left for other lanes: the Pro "Edge" column and server-side sorts use international numbers while US cards show
US numbers (Lane A, relevant to #69); My list uses the international return; the "Leans your way (55–80%)" filter
label is chance-based (Lane A filters).

## Group 2: FAQ and test vs live (`claude/qa-b-faq`, on top of `claude/qa-b-return`, "QA-B: 4, 48, 3, 36, 35")

| item | status | evidence |
|---|---|---|
| 4 (FAQ "win often" vs "won 90%" vs losing money) | fixed (not verified live) | `HIT_RATE_VS_PROFIT` now says most best bets win because most pay under 1.5x, and that a record can win most bets and still lose money. On /about and /pricing it is followed by the live facts (`hitRateLive`: "Live so far: 78% of 1,155 settled best bets won, and together they returned −1.3%."). |
| 48 ("everyone sees the same numbers") | fixed | Free sees bands, so that claim was false. `SAME_FOR_EVERYONE`: bets picked the same way for everyone, never from your bets; Free sees fewer, later, as ranges. Used on /about and /pricing; /terms, /disclaimer and the landing FAQ reworded to match. |
| 48 (cancel path) | fixed | /pricing "Can I cancel any time?" links to /account and names the **Manage billing or cancel** button (exists in `components/auth/AccountActions.tsx`, shown to users with a Stripe customer; /terms, /refunds, /contact already said this). |
| 3 (no reason given for test vs live gap) | already on final | `calibration()` in `lib/proof.ts` appends "Why live trails testing: our win chances have run high, bets we gave X% won Y%" to every proof line once 50+ bets settled (seen on kismetodds.com Nov 21: "87% won 78%"). Why this bet?'s "Live record so far" now carries it too (group 1). |
| 36, 35 ("52 weeks") | fixed | `testSpan` always names the weeks that had bets and their concentration: "past markets from Feb 25 to Nov 18 (bets in N of 52 weeks, 81% in the last 2)". /track-record's method note says "replays 52 weeks one at a time, but only N of them had best bets, with X% of all test bets in the last two". e2e `proof.spec.ts` asserts the clause on /track-record, /about, /pricing. |

Gates: typecheck, lint clean; vitest green except the pre-existing teaser test; e2e proof, s6, s1-landing, a11y 14 + 41 passed; check:js 149.6 kB.

## Engine: same-payout control count (`claude/qa-b-ledger`, from origin/final)

`engine/ledger.py` `same_payout`: picks now count only when a comparison bet names them (control `pick_id`), so
rows logged before `control.jsonl` existed (no event_id, no pair) no longer inflate the picks' entries and events.
Output shape unchanged; `docs/03-data-model.md` comment updated. New pytest
`test_same_payout_counts_only_picks_with_a_comparison_bet`; engine suite 106 passed. Not verified live: the next
graded scan rewrites `ledger_summary.json`. Once it has, `components/results/summary.ts` could show the picks'
event count again (it hides it because of this bug). Left for Q/main.

## #35: walk-forward backtest re-run on evenly spread weeks (local rebuild, NOT production)

Production's price history is in the Actions cache and can't be rebuilt here, so this is a fresh local sample with
the same code and `config/demo.json`: `fetch_closed.py --days 365 --window-days 30 --per-window 150` (449,282 closed
markets), `fetch_prices.py --extend --per-niche-month 300` (151,345 snapshots), then `python -m engine backtest`
(52 weekly folds, ran Nov 21).

| | this even rebuild | production (kismetodds.com, Nov 21) |
|---|---|---|
| weeks with best bets | 42 of 52 (Dec 3, 2025 to Nov 11, 2026) | most bets in a few recent weeks |
| share in last 2 weeks | 8.3% (busiest week 7.4%) | 81–87% |
| best bets (taker) | 3,098 bets in 1,606 events, won 78.7% | |
| return per bet | +6.4%, t 5.5 (event-clustered) | +11% |
| weeks that made money | 32 of 42 | |

Half-life sweep (taker): 21 d +4.8% t 1.75 (494 bets); 45 d +4.9% t 2.3 (911); 90 d +7.4% t 4.0 (1,404);
180 d +7.4% t 4.8 (1,859); none +6.4% t 5.5 (3,098, chosen). The half-life is picked in-sample among five, so
read the chosen t as a little optimistic; every setting is positive. By payout (best bets): <1.5x +5.4% (2,566),
1.5–2x +7.2% (270), 2–3x +11.9% (72), 3–5x +48.9% (148), 5–10x −36.7% (28), 10x+ −16.3% (14): the last two are
under the 30-bet floor and show as "too few tested bets".

For Q: an earlier even rebuild (previous session, parameters not recorded in this log) gave about +2% with t < 1;
this one gives +6.4%, t 5.5. The two are not reconciled: don't read the difference as sample size alone. Raw
output (not committed):
`/tmp/claude-0/-home-user-MarketEdge/5dc80970-cb59-531c-a07f-e3685e3d0674/scratchpad/bt/output/backtest.json`.

## #69

Not touched: Lane A owns the sort. `BetQuote.pays` (after the fee, the card's figure) is exported for it.

## Follow-ups after review

- #5 per-fixture check: `quoteStars()` puts stars on the quote's own return, so an exact 0% return no longer gets
  "Fair value". `one-return.test.tsx` checks every fixture bet: at an exact return ≤ 0 there are no stars and no
  "Better price than usual"; above 0 there are stars; a Free quote never carries the arithmetic (`betQuote().math`
  is null, and it's the only source for the drawer, table and compact-card hovers). Points are measured before the
  fee by design, so "+0.8 pts" beside a return ≤ 0 is expected; the verdict then says "not by enough to cover the fee".
- iPhone spec (`e2e/overhaul-iphone.spec.ts`, WebKit projects): **not run in WebKit**, because WebKit isn't
  installed here. I ran it in Chromium with iPhone viewport and touch emulation at 390×844 and 430×932: 48 passed,
  6 failed. Every failure is "input 148×15" small tap targets: the stake input inside the closed "Why this bet?"
  details, one per card. origin/final da64226 fails the same way under the same emulation (/ and /bets), so it
  isn't from this branch. It needs a real WebKit run.
- Combined tree (`qa-b-faq` + `qa-b-ledger` merged with origin/final da64226): tsc and lint clean; vitest green
  except the teaser test, which I confirmed fails on da64226 itself (`funnel-db` and `api` timing flake under load
  and pass on rerun); pytest 106 passed; full chromium e2e 80 passed, 1 failed (trading-paper, missing extension
  deps); check:js 142.1 kB vs 141.9 kB on da64226 (+0.2 kB).
- Branch history: a force push was refused, so `qa-b-return` stays on its original base and `qa-b-faq` merges it in.
  Both merge cleanly with origin/final.
