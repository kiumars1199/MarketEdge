# Overhaul report (Nov 20, 2026)

Evidence for every item in `docs/OVERHAUL.md` (sections 0, A–G). Raw lane notes: `docs/overhaul-evidence/<lane>/NOTES.md`.
Before screenshots and prod headers (taken 16:58 UTC, before any change): `docs/overhaul-evidence/before/`.

## Decisions made without Q
1. **Push once at the end.** Q chose this when asked; recorded here because CLAUDE.md now says every push to `final` deploys prod. All lanes merge on local `overhaul`; one push to `final` after all gates pass on the merged tree.
2. **Playwright browser path.** The pinned Playwright (1.65.1) wants Chromium build 1255; the sandbox has 1243. Added an opt-in `PW_CHROMIUM_PATH` launch override to both Playwright configs (unset = old behaviour, CI unaffected). WebKit 27.2 was downloaded for §D after opening the Playwright CDN on the session network.
3. **Network.** Created a personal cloud environment "MarketEdge" for this session (Playwright CDN, kismetodds.com, Polymarket hosts, research sources). No secrets added.
4. **Lane F1 superseded by `claude/us-venue`** (Q's instruction). F1's own WIP fetcher (`worktree-agent-aef7f199d3acc4117`, `pipeline/fetch_polymarket_us.py`) is not merged, to avoid duplicate matcher code. Its live findings (gateway endpoints, slug patterns, 27% exact-bet coverage, 46/46 side agreement) are kept in the F1 evidence notes.
5. **Migration numbering.** `alert_events(rule_id)` index renumbered to `20261120000400_…` so it doesn't collide with lane F2–4's `…0200_funnel_events.sql`.
6. **Banned-word rule** (§A/§B checks): one helper, `apps/web/lib/banned.ts`. Whole words, case-insensitive, on visible text + `<title>` + meta/og/twitter descriptions; scripts, RSC payloads and URLs excluded (so "scripts" ≠ pts, "event" ≠ EV). Landing also bans counts above 3 digits (times and years excluded).
7. **Bets with no value after fees get no stars.** The spec says 1–3 stars; forcing 1 star on an overpriced bet would call it "Fair value". `stars()` returns null and the card says "No value at today's price".
8. **"$10 wins $5.60" means profit after fees** (the spec's wording), used consistently on every card. The old card said "get $X back" (total); mixing the two was confusing.
9. **Research rule IDs.** Lanes cite rules by their research IDs (R1-n, R2-n); `docs/research/overhaul.md` lists the final 15 under those same IDs, so citations made before consolidation stay valid.
10. **Lane B started before R1 finished.** Cards and filters rest on R2's rules (data display, usability), which were ready. Lane A (landing copy) waits for R1's value proposition.
11. **Lane E's live-filter result (`flag_max_edge`, default off) ships as a flag, not on.** Its held-out gain is noise-sized and the candidates weren't pre-registered.
12. **Payout wording vs Polymarket.** Polymarket's trade sheet says "To win $19.89" for the *total* payout. The card keeps the spec's "$10 wins $X" (profit); the first line of "Why this bet?" states the total ("If it wins you get $X back"), and the card never says "To win".
13. **Banned-count regex fix.** R1 found `BIG_COUNT` matched "Unlock 14 more" (the M of "more"). Fixed with a no-letter lookahead; tests cover it.
14. **Lane E merge conflict in `engine/scan.py`.** Kept both sides: G's `cap_per_event` runs after E's `is_best` (which now includes the optional `flag_max_edge`). Engine tests after the merge: 99 passed.
15. **Proof line keeps the test's +14%, with its concentration stated.** `lib/proof.ts` now says the span and "86% of bets in the last 2 weeks" instead of "1 year" and drops "enough to compare". It still quotes production's backtest number, because the even rebuild (+2%) was run locally on a different sample and isn't what production publishes. Replacing the headline number waits on a production re-run (see Waiting for Q).
16. **G5 cap reported both ways.** The scan holds slots for lines already in the ledger, so live behaviour is closest to "first 2 per game" (−0.9%), not "best 2" (+2.1%). Both are in the table; neither is a claim the cap improves returns.
17. **Static CSP on the prerendered signed-out pages (lane C).** One cached HTML file can't carry a per-request nonce, so `/`, `/pricing`, `/about`, `/track-record` and the legal pages use `script-src 'self' 'unsafe-inline'` plus the Stripe, Vercel and PostHog hosts, without `strict-dynamic`. Every other directive matches the nonce policy, and dynamic pages keep nonce + `strict-dynamic`. Shipped because §C requires these pages to be static and they take no user input; it's reversible (drop `force-static`). Details: `docs/overhaul-evidence/C/NOTES.md` "Needs owner sign-off".
18. **Risk bands (lane B).** Safer = wins 85%+, Balanced = 70–85%, Bigger payouts = under 70% (the 40% floor stays). They follow where Best bets actually sit on a real scan: 740 of 1,070 at 85%+, 268 at 70–85%, 62 under 70%.
19. **No skeleton on `/combos`, `/kalshi` and `/m/[id]`.** A `loading.tsx` there streamed HTTP 200 before `notFound()` ran, so non-testers got 200 for beta pages (the admin e2e caught it). Those three keep the right 404 status; every other signed-in route keeps its skeleton.
20. **The drawer follows the card's venue rule.** US-listed → "Bet on Polymarket US" (`us.url`). `us: null` → the grey "International only" label, the international link and "Not available to US residents". Scans from before the US venue (no `us`) → "Open on Polymarket" as before. Under the US button the drawer states the US price ("68¢ on Polymarket US · Polymarket US price, incl. its fee"). The drawer's headline figures above it are still the international ones; the card face (§G1) is the US one.
21. **Stretched card links count as the card for tap size.** The /markets row title is a link whose `::after` covers the whole card, so the tap area is the card (≥ 44 px). The iPhone checker now measures that box, not the text line.
22. **Old e2e brought up to the §B card.** `s7-upgrade` checked the removed T-291 overlay (Esc and close button) and the old `one-bet` card; it now checks the inline "Unlock N more bets" card and counts `bet-card`. Its checkout-status check waits 30 s, inside the page's own 60 s poll (it saw the mock webhook land after 5 s once under full-suite load). Its free-account delete got the same 30 s budget as the paid delete in the same file: timed, the first delete on a fresh `next dev` server takes 2.5 s for the DELETE and 5.0 s to the redirect (both routes compile on first hit), and a second one takes 0.7 s / 1.3 s, so it's dev compile time, not the delete or the lifecycle hook. The admin beta-link check waits 15 s for `/api/me`; it passed 2/2 alone and failed once in the full run under load.
23. **Landing JS kept under 150 kB after the new card.** The card pulled in zod (via `lib/filters/apply`) and the trade-ticket code (via `venueOf`). Both now come from light modules (`lib/filters/bands`, `lib/trade/venue`), and the My-list star inside the closed "Why this bet?" loads on its own. Result: 183.8 → 148.5 kB.
24. **Deploy-day data shape checked.** Production's data has no `top.json`/`counts.json`, no `us`/`meta.us` and an old `ledger_summary` until the first scan after deploy. A production build on `origin/live`'s current output builds and serves `/`, `/pricing`, `/about`, `/track-record` and `/terms` with no console or CSP errors (the signed-out static CSP included; "Why this bet?" opens). Signed in (on `next dev` with the mock, which the production build turns off), `/`, `/bets`, `/markets`, `/track-record`, `/pricing`, `/watchlist` and `/account` render with no errors, and the drawer falls back to "Open on Polymarket". Without the migrations and secrets, the funnel and lifecycle hooks log and carry on ("[funnel] not recorded", "first sign-in hook failed: UNSUBSCRIBE_SECRET is not set"), and `/api/revalidate` answers 401.
25. **Test fixtures use the working US link** (`polymarket.us/event/…`, G6). The engine already emits it; only the fixtures still had the dead `/market/` pattern.
26. **Post-deploy numbers stay off `final`.** The prod speed numbers are measured after the one push, so they're committed on `overhaul` and the backup branch `claude/dazzling-hypatia-d3jvim`, not pushed to `final` (a second push would be a second deploy). The sha deployed is the one in the last message.

## Waiting for Q
- Apply Supabase migrations `20261120000200_funnel_events.sql`, `20261120000300_lifecycle_emails.sql`, `20261120000400_alert_events_rule_id_index.sql` to the live project (not applied by agents).
- Set secrets: GitHub `RESEND_API_KEY`, `ALARM_EMAIL_FROM`; Vercel `RESEND_API_KEY`, `EMAIL_FROM`, `UNSUBSCRIBE_SECRET`, `CRON_SECRET`. Rerun `node ops/stripe-setup.mjs` so the webhook subscribes to `invoice.paid` (touches live Stripe config).
- **Re-run the backtest on production data with an even history.** The public test has 86–87% of its best bets in the last 2 weeks; on an evenly sampled local rebuild that share is 0.9% and the result is about +2% per bet (t < 1). Backfill the fetch (it keeps only the newest 2,000 events per tag) and re-run; until then the "enough to compare" bar (~10 US events, from the concentrated run's t of 34.7) is too low — the even rebuild implies ~1,340 events. Research doc §5, §7.
- **`engine/ledger.py` same-payout picks** include rows logged before `control.jsonl` existed (no `event_id`), so the picks' event count is inflated. The page hides that count until it is fixed.
- `vercel.json` now has 3 crons; confirm the Vercel plan allows it (fallback: run trial reminders from `/api/settle/run`).
- Lane C config (**Q is setting these**, Nov 20): `REVALIDATE_SECRET` in Vercel and as a GitHub secret, and `SITE_URL` or `REVALIDATE_URL` as a GitHub variable. Without them `upload.py` logs "revalidate skipped" and pages refresh within 300 s anyway.
- ~~Lighthouse LCP < 2.0 s (§C)~~ **Resolved by Q (Nov 20): accepted as is** (production 2.05–2.26 s). No React removal.
- ~~Sign-off on the static CSP (Decision 17)~~ **Resolved: Q signed off** (Nov 20).

## Merged
- PR #3 `claude/us-venue` (kiumars1199/Kismet): merged via `overhaul` (3 commits: 29282c9, d40090f, ddf9cfd).

## Gates on the merged tree — PASS
Final run on `overhaul` at 80de9f8 (lint, typecheck, unit, extension, engine, JS budget, demo e2e), then the paid e2e again in full at 42da5d2 after one wait was widened (Decision 22). Same results at ce9ee55 earlier:
- `pnpm lint`: 0 warnings. `pnpm typecheck`: clean.
- `pnpm test`: 102 files, 1,070 tests, plus ops 36/36.
- Extension: typecheck clean, 42/42 tests.
- Engine: `python3 -m pytest -q engine/tests`, 105 passed.
- `pnpm build && pnpm check:js`: `/` first-load JS 148.5 kB gzipped (budget 150).
- e2e, demo config (`playwright.config.ts`): **132/132** (chromium 78 + iPhone WebKit 54).
- e2e, paid config (`playwright.paid.config.ts`): **32/32** (chromium 16 + iPhone WebKit 16). `overhaul-landing` re-run with the table/chart check: 3/3.

## 0. Research — PASS
- `docs/research/overhaul.md`: 15 rules (IDs R1-1…R1-8, R2-1…R2-6, R2-8; R2-7 merged into R2-5), each with source links and an example to copy; chosen value proposition; 5 pages to imitate with screenshots in `docs/research/screens/` (polymarket-trade, polymarket-sports, polymarket-game, robinhood-event, actionnetwork-projections). Lane files: `overhaul-r1.md` (256 lines), `overhaul-r2.md` (238 lines, with a "Removed claims" table).
- Sources: every source was downloaded and read on Nov 20 (curl + text extraction). The first R2 pass ran before the hosts were opened and used search snippets; it was redone after the network change and unverifiable claims were deleted.
- Not reachable even after allowlisting: kalshi.com (bot wall, HTTP 429), news.kalshi.com (403), pmc.ncbi.nlm.nih.gov (reCAPTCHA), sportsbook.fanduel.com (403). No rule rests on them.
- Chosen headline "Which Polymarket bets are worth it today?" and sentence "Placing a bet or two? Kismet shows which Polymarket bets look like good value today, how often bets like them win, and what $10 pays." Scoring is judgment against stated 5-second criteria, not a user test.
- Citation check: see the `git log` grep under §A, §B, §D below.

## A. First screen and landing page — PASS
- First screen (390×844 and 1440×900): headline "Which Polymarket bets are worth it today?", one sentence, one "Sign up free" button, one real bet card in the §B style. Below it, in this order: 3 steps, 3 real bets, plans, a 5-question FAQ, then "See how we track results" → /track-record. The market-says/won-before bars and "Bars use…" are gone.
- Headline options (research R1-1, R1-2, R1-3, R1-7):
  1. **Shipped:** "Which Polymarket bets are worth it today?"
  2. "Find the good-value bets on Polymarket." Clear, but it names neither the reader nor "today".
  3. "Polymarket bets that pay more than they should." Rejected because it reads as a profit claim (R1-7).
  Choosing one is judgment against the research's 5-second criteria, not a user test.
- Check: `e2e-paid/overhaul-landing.spec.ts`, 3 tests, all pass on the merged tree:
  - The server HTML of `/` and the hydrated page at both sizes contain no banned word ("edge", "spread", "pts", "model", "priced below their record", "$1 share", "walk-forward", "EV", "t-stat") and no count above 3 digits (`lib/banned.ts`).
  - No stats table or chart, the section order above, exactly one primary button in `main` above the fold, the hero card inside the first screen, and no sideways scroll.
  - The `pts` failure noted in lane A's notes was the old card; it is gone since lane B merged.
- Screenshots: `docs/overhaul-evidence/A/home-390x844.png`, `home-1440x900.png` (+ `-full`), re-shot on the merged tree. Before: `docs/overhaul-evidence/before/home-*.png`. Lane notes: `docs/overhaul-evidence/A/NOTES.md`.

## B. Cards, Best bets, filters — PASS
- Card face, seven slots: plain title ("Miami (OH) to win the 1st quarter"), "Bet {side} at 69¢", "Wins about 9 in 10", a 1–3 star value rating, "$10 wins $4.08", the closing time, and the bet button. Everything else is inside "Why this bet?".
- Free: one solid card with a lock and "Unlock N more bets" → /pricing. No blur, no fade.
- /bets: "Today's top 5", then "More bets". No tier or section words.
- One chip row: top 6 sports + "More sports", Today / This week, Safer / Balanced / Bigger payouts, "On Polymarket US", "More filters". A filter change keeps the old list on screen, dimmed and `aria-busy`, until the new one arrives (no flash, R2-6).
- Checks, all passing on the merged tree:
  - `e2e/overhaul-cards.spec.ts`: every card has at most 7 visible text slots outside "Why this bet?"; banned-word grep on `/bets`; chip row lands in the URL; tap targets.
  - `test/card-render.test.tsx` renders the card for all 151 fixture Best bets, exact and Free-banded. It checks no banned words, ≤ 7 slots and the venue rule.
- Before/after screenshots: `docs/overhaul-evidence/B/shots/before-bets-*.png` and `after-bets-*.png` (390×844 and 1440×900), plus the served HTML in `before-bets.html` and `after-bets.html`. Lane notes: `docs/overhaul-evidence/B/NOTES.md`.

## D. iPhone — PASS
- Playwright **WebKit** (`devices["iPhone 15"]` and `["iPhone 15 Pro Max"]`, both `defaultBrowserType: webkit`) at 390×844 and 430×932. Projects `iphone-390` and `iphone-430` are in both Playwright configs.
- Demo config (`e2e/overhaul-iphone.spec.ts`):
  - 24 pages: every app page, the legal pages, /maintenance, and a missing page that must return 404.
  - An event page and a market page.
  - The drawer: fits the screen, closes, keeps focus usable.
  - Search input stays visible when focused.
- Paid config (`e2e-paid/overhaul-iphone.spec.ts`): the signed-out pages `/`, `/pricing`, `/about`, `/track-record`, `/signup`, `/login`, `/reset-password` and `/terms`.
- Each page is checked for no horizontal scroll, tap targets ≥ 44 px, nothing under the sticky header or the bottom tab bar, and no loading flashes. Checker: `apps/web/e2e/iphone/iphone.ts`. Two exemptions: WCAG 2.5.8 inline links inside a sentence, and stretched card links, which count as the card (Decision 21).
- Before the fixes, iphone-390 failed 17 of 27. Mostly 36–41 px chips, card links, legal nav, the switch and selects; the before shots are in `docs/overhaul-evidence/D/before/`.
- After: demo 54/54 and paid 16/16 iPhone tests pass, inside the full e2e runs below. Fixes are in commits 2f3d382, 149f6ec and 253ec44 (R2-8).
- Screenshots of every page at both sizes: `docs/overhaul-evidence/D/*.png` (57 files).

## G1. Cards and buttons — PASS
- Bets with `us`: the card shows the US price and return, "Polymarket US price, incl. its fee", and "Bet on Polymarket US" → `us.url`. Bets with `us: null`: a grey "International only, not on Polymarket US" label and no primary button; the international link sits in "Why this bet?" with "Not available to US residents".
- The bet drawer follows the same rule (Decision 20, commit 253ec44).
- Check: `e2e/overhaul-cards.spec.ts` "venue" passes. No card's primary button points to polymarket.com when `us` exists, and no primary button exists when `us` is null. `test/card-render.test.tsx` checks the same thing on all 151 fixture bets.

## G2. Lists — PASS
- "On Polymarket US" is on by default for every tier. Best bets with it on = `us` present and `us.edge ≥ meta.rule.min_edge`, ranked by US return.
- Free's daily 10 come from that set when it has at least 10. Counts and headlines use the same set: `counts.json` and `top.json` from `engine/precompute.py` too.
- Checks:
  - `test/us-filter.test.ts` (8 tests: default on, the set, ranking, one count, Free's 10, the fallback, no-op without coverage, /markets ignores it).
  - `engine/tests/test_precompute.py::test_counts_use_the_us_set_when_the_scan_priced_us`.
  - e2e "'On Polymarket US' is on by default; turning it off includes international bets".
  - Screenshot with the default: `docs/overhaul-evidence/B/shots/after-bets-390x844.png` (fixture: 34 of 151 Best bets).

## G3. /track-record — PASS
See §E below: US record first (settled bets, events, return), then the same-payout card (events), then the whole record (`first`) with the international-only line, then the test with its real span. "Needs" is counted in events. Numbers: `docs/research/live-vs-backtest.md`.

## Research citations
`git log origin/final..overhaul | grep -E "R[12]-[0-9]"`: 10 commits cite research rules: R1-1 (2), R1-2, R1-3, R1-4, R1-7 (2), R1-8, R2-1, R2-4, R2-6 (2), R2-8 (4). Examples: 3f00859 (landing, R1-1…R1-8), 1b40593 (card, R2-1, R2-4), 6c37f5e (Best bets, R2-6), 2f3d382 (tap targets, R2-8).

## E. Results and the live record — PASS
Research file: `docs/research/live-vs-backtest.md` (§1–8). Lane notes: `docs/overhaul-evidence/E/NOTES.md`. Data: `origin/live` @ ecbc3a7 (Nov 19 19:47 UTC) plus public Gamma/CLOB reads.

Why live (−2.1%) trails the test (+14–17%):
| Question in §E | Answer | Evidence |
|---|---|---|
| Real ask after fees? | No. Replaying entries at the logged ask moves the test −0.2¢ (12.21¢ → 12.02¢ mean charge); +2.1% → +1.9% per bet | §7, `scripts/ledger/calibrate_ask.py` |
| Edge tier mixed in? | No, the ledger logs Best bets only | §2 |
| 90¢+ favourites? | No, price ≥ 60¢ filter: −1.2% in-sample | §3 table |
| Weather? | Roughly break-even (+0.9%, 333 settled); sports lost (−2.7%), two soccer games = 93% of the loss | §2, `cap_check.txt` |
| Lookahead? | None found in snapshot prices near close | `scripts/ledger/lookahead.py`, §2 |
| May week a data bug? | Not proven; left unchanged | §2 |
| Real cause | Model win chances too high live: predicted 86.6% vs 77.4% won; and the test's sample is 86–87% in the last 2 weeks | §1, §5 |

Filter behind a flag (`flag_max_edge = 0.10`, default off, `config/demo.json`):
| Rule | In-sample (862 rows) | Held-out (149 rows) | Distinct bets |
|---|---|---|---|
| Off | −2.1% | +9.6% | 742 bets, +1.3% |
| On | −1.7% | +12.6% | 574 bets, +1.9% |

Re-run of the walk-forward test (local even rebuild: 34,679 markets, 10,733 events):
| Pricing | Bets | Events | Per bet | Per event | t (by event) |
|---|---|---|---|---|---|
| Mid + ½ spread | 432 | 214 | +2.1% | +0.9% | 0.80 |
| Ask, median premium (+1.05¢ from 593 live asks) | 474 | 237 | +1.9% | +1.9% | 0.71 |
| Ask, mean premium | 463 | 231 | +2.8% | +2.5% | 1.07 |

Filters chosen on older folds (Nov 19, 2025–Sep 16, 2026), reported on the newest 8 (Sep 23–Nov 11): at the ask, 23 events, −19.1% per event, t −0.81; "validated" selects nothing. Too small to judge.

`lib/proof.ts` (feeds /pricing, /about, llms.txt, MCP, /track-record):
- Before: "Testing on 1 year of past markets: best bets, +14% per bet. Live since Nov 17: 742 settled bets, +1.3%, enough to compare with testing."
- After: "In testing on past markets from Nov 30, 2025 to Nov 14, 2026, 86% of bets in the last 2 weeks: best bets, +14% per bet. Live since Nov 17: 742 settled bets, +1.3%." "Enough to compare" is now counted in US events only and doesn't appear until they settle.

/track-record (G3 too): order is US record → "Kismet's picks vs other bets at the same payout" (events) → whole record with the international-only line → testing. One headline number per card; t-stat and ¢/share inside "Details". "Bets we rated higher did better" is computed and only shows when true (it isn't on Nov 20 production: 13.1/14.0/10.2/16.9¢).
Screenshots: `docs/overhaul-evidence/E/before-track-record-{390x844,1440x900}.png`, `after-track-record-*.png`, `after-realledger-track-record-*.png` (real live ledger).
Tests: `engine/tests/test_max_edge.py`, `engine/tests/test_ask_price.py`; engine suite 99 passed on the merged tree.

## G4. US-native scan — PASS
Behind `US_NATIVE_SCAN` (default off). Live run with it on, Nov 20 (`docs/overhaul-evidence/G/NOTES.md`):
```
polymarket us native: 347 scored of 8747 open US markets
meta.us {'ok': True, 'markets': 84703, 'matched': 6785, 'native': 347, 'best_on_us': 116, 'best_us_edge': 105}
native flags 19 (culture 9, finance 8, politics 2), native Best bets 0
```
First result: "US Diesel Prices This Month: Above $5.70", No at 73¢, fee 1.9¢, 10.6¢ edge, link `polymarket.us/event/usdsl-month-2026-11-30` (opens, G6). Fixed in passing: US `outcomes` order is unreliable, so the long side is put first. Tests: `engine/tests/test_us_native.py` (flag off → 0 native, on → 4 native, 1 Best bet logged as `venue: "us"`).

## G5. Best bets capped per game — PASS
`max_best_per_event = 2` (config). Live scan Nov 20: 589 Best bets capped, max 2 per event over 459 events. Retroactive on the live ledger (`python3 scripts/ledger/cap_check.py`, full table `docs/overhaul-evidence/G/cap_check.txt`):
| Rule | Settled | Events | Per bet | Return |
|---|---|---|---|---|
| No cap | 593 | 178 | −0.56¢ | −0.7% |
| Cap 2, best ranked | 317 | 178 | +1.64¢ | +2.1% |
| Cap 2, first logged (closest to live behaviour) | 317 | 178 | −0.71¢ | −0.9% |
| Cap 1 | 178 | 178 | −0.61¢ | −0.8% |
Not monotonic; weak evidence on returns. The cap does what it's for: one game's lines can't flood the list or the record. Tests: `engine/tests/test_best_cap.py`; backtest twin `engine/backtest.cap_mask`.

## G6. Polymarket US link — PASS (pattern changed)
`/market/<slug>` does **not** open the market (desktop: 307 to home; iPhone: 307 to the app-install link). `/event/<event slug>` does, on both. `US_URL` is now `https://polymarket.us/event/{slug}`; 60 of 60 sampled sports twins confirmed. Raw: `docs/overhaul-evidence/G/linkcheck.json`; screenshots `docs/overhaul-evidence/G/shots/` (desktop Chromium 1440×900 and WebKit iPhone 15 for each URL).

## F1. US users and Polymarket US — PASS (via PR #3 + G1)
- Research: `docs/research/polymarket-us.md`. US residents can only trade on Polymarket US (CFTC, KYC); international order placement is geoblocked for them. Public API `gateway.polymarket.us` (no key, 25 req/s). Fee Θ·p(1−p), Θ = 0.095. 27% of our scan (6,775 of 24,937) is listed on US, all sports; median price gap vs international 0.5¢; a US user pays +0.58¢ per share median on the same bet.
- Fix built: every market carries `us` (link, side, US ask, fee, edge) or null; the ledger grades a separate US record (PR #3, merged via overhaul); US-native markets scored behind `US_NATIVE_SCAN` (G4); links use the working `/event/` pattern (G6). Card side: see G1.
- F1's own WIP fetcher (`f6a1e28`) is not merged (decision 4). Its independent findings agreed with PR #3: same gateway endpoints, 27% exact-bet coverage, 46/46 sides agreeing.

## F2. Stale-data alarm — PASS
`ops/stale_alarm.mjs` + `.github/workflows/stale-alarm.yml` (every 15 min, reads `/api/meta`, Resend to the ops inbox when the scan is > 45 min old or the site errors; one alert + one all-clear per incident; state in the Actions cache).
```
node --test ops/tests/stale-alarm.test.mjs
ok 1 - a stale timestamp across several consecutive runs sends exactly one alert, recovery exactly one all-clear
ok 2 - 45 min exactly is fine; 46 is stale
ok 3 - site error path: HTTP 500 / network failure over consecutive runs is one alert, recovery one all-clear
... 9 of 9 pass
```
Limit: scheduled workflows run from the default branch's copy, so the alarm starts once this reaches it. Details: `docs/overhaul-evidence/F234/NOTES.md`.

## F3. Funnel tracking — PASS
Steps: landing_view, signup_start, upgrade_view (signed out, per visit); signup_done, first_bets_view, first_bet_click, checkout_start, trial_start, paid (once per account, enforced by `unique(user_id, event)` in `funnel_events`). PostHog gets a capture only for a new row. Admin page `/admin/funnel` (totals, step conversion, daily counts; screenshot `docs/overhaul-evidence/F234/admin-funnel.png`).
e2e: `e2e-paid/overhaul-funnel.spec.ts` walks the funnel with repeats (reloads, second click, Stripe retry, renewal) and asserts each step once, and that a forged `paid` from the browser gets 400 — 2 passed. Unit: `lib/funnel.test.ts` 12, `test/funnel-db.test.ts` 5 (PGlite, all migrations).

## F4. Lifecycle emails — PASS
Welcome (3-line card explainer, unsubscribe + List-Unsubscribe), trial ends in 2 days with how to cancel (daily cron), receipt on first paid invoice, cancel confirmation. Sent once each via a claim row (`lifecycle_emails` PK user/kind/ref). `lib/email/lifecycle.test.ts` (15 tests) renders each, checks every link resolves to a real app route, and checks unsubscribe on the optional mail only (receipt, cancel and the trial notice are transactional/required). No real email sent; Resend mocked.

## C. Speed — PASS (LCP accepted by Q): edge cache HIT, cold TTFB 191–348 ms, CLS 0, JS 148.5 kB; Lighthouse LCP 2.05–2.26 s is over the < 2.0 s target, and Q accepted it as is on Nov 20
Lane notes: `docs/overhaul-evidence/C/NOTES.md`. Prod before (Nov 20 16:58 UTC, `docs/overhaul-evidence/before/hdr_*.txt`): `/` TTFB 2.35 s, `/pricing` 0.59 s, `/track-record` 0.36 s, `/about` 0.51 s; every page `cache-control: private, no-cache, no-store`, `x-vercel-cache: MISS`.

What changed: engine writes `top.json` + `counts.json` (+ per-category tops) each scan; signed-out pages `/`, `/pricing`, `/about`, `/track-record`, legal are static + ISR (`s-maxage=300, stale-while-revalidate`), revalidated by `ops/upload.py` via `/api/revalidate` (401 without the bearer, 200 with it); charts lazy-loaded; header no longer pops in (CLS 0.018 → 0); signed-in routes get skeletons.

Local, real-size data (prod build, 4-core sandbox):
| | Before | After |
|---|---|---|
| `/` TTFB cold / warm | 2095 / 35 ms | 738 / 9 ms (`x-nextjs-cache: HIT`) |
| `/track-record` cold / warm | 1864 / 36 ms | 1022 / 11 ms |
| `/` first-load JS (gzip) | 203.7 kB | 145.1 kB on the merged tree (budget 150 kB, `pnpm check:js` OK) |
| `/track-record` JS | 286.6 kB | 145.8 kB |
| Lighthouse mobile `/` perf / LCP / TBT | 79–80 / 3.15 s / ~550 ms | 92 / 2.74 s / 238 ms |
| `/bets` perf / LCP | 71–73 / 3.7 s | 85 / 3.2 s |
| INP `/bets` | 112–144 ms | 96–104 ms |
| Landing render from `top.json` vs `markets.json` | 1549–1681 ms | 394–403 ms |
| Signed-in tab tap → first paint | 326–639 ms | 72–181 ms |

**Lighthouse mobile on the merged tree** (Nov 20, 20:42 UTC; production build, accounts on, today's production data shape; `scripts/perf/lighthouse.sh`, RUNS=2, load average 1.4):
| page | perf | LCP ms | CLS | TBT ms | FCP ms |
|---|---|---|---|---|---|
| `/` | 91 / 95 | **2817 / 2632** | 0 | 257 / 161 | 938 / 917 |
| `/pricing` | 90 / 98 | **2578 / 2012** | 0 | 314 / 143 | 772 / 764 |
| `/track-record` | 74 / 73 | **2785 / 2819** | 0 | 956 / 1034 | 917 / 918 |

- **LCP misses the < 2.0 s target on every page.**
  - The LCP element is the hero sentence (`/`) or the header paragraph. It is in the server HTML and paints at FCP: unthrottled, LCP = FCP = 148 ms.
  - Lighthouse's simulated LCP is 83% "render delay". Its pessimistic graph counts every request that started before that paint, and those are the page's JS chunks. About 105 of the 148 kB is the React and Next framework floor.
  - Tried: inlining the CSS (`experimental.inlineCss`). FCP got about 110 ms faster, LCP didn't move (2361–2792 ms), so it was dropped (§C: no measured gain, no change).
  - Getting under 2.0 s on this metric likely means shipping these pages without React hydration. That's a product call, listed under Waiting for Q.
- `/bets` is signed-in only on production (signed out → /signup), so Lighthouse can't measure it without a session. The accounts-off local number is in the table above (LCP 3.2 s).
- CLS is 0 everywhere. INP is 72–104 ms. The JS budget passes (148.5 kB).

**Production, after the deploy of c2533e4** (Nov 20, 21:21–21:26 UTC; `ops/perf-prod.sh https://kismetodds.com`, no cookies):
| page | 1st request | 2nd request | cache-control |
|---|---|---|---|
| `/` | 200, 327 ms, HIT | 200, 254 ms, HIT | public, max-age=0, must-revalidate |
| `/pricing` | 200, 348 ms, PRERENDER | 200, 247 ms, HIT | same |
| `/about` | 200, 191 ms, PRERENDER | 200, 212 ms, HIT | same |
| `/track-record` | 200, 273 ms, PRERENDER | 200, 220 ms, HIT | same |
| `/terms` | 200, 195 ms, PRERENDER | 200, 197 ms, HIT | same |
| `/privacy` | 200, 307 ms, PRERENDER | 200, 160 ms, HIT | same |

Before (16:58 UTC): `/` 2.35 s, `private, no-store`, MISS. Cold TTFB is now under 500 ms on every signed-out page (PRERENDER is the first hit on a new deploy; HIT after).

Lighthouse 12.8.2 mobile on production, two passes:
| page | perf | LCP ms | CLS | TBT ms |
|---|---|---|---|---|
| `/` | 92 / 97 | 2150 / 2083 | 0 | 319 / 165 |
| `/pricing` | 98 / 98 | 2070 / 2052 | 0 | 104 / 140 |
| `/track-record` | 85 / 81 | 2260 / 2252 | 0 | 544 / 722 |

- LCP is 50–260 ms over target on all three; reason and options under Waiting for Q. CLS passes.
- INP isn't measured by a Lighthouse page load; locally it is 72–104 ms (target < 200).
- `/bets` is behind sign-in on production, so it has no signed-out Lighthouse number.
- Live check: `/`, `/pricing`, `/track-record` and `/about` load at 390×844 with no console or CSP errors, and "Why this bet?" opens on the landing card.
- Until the first scan on the new engine (run on Railway), the live data has no `us`, so cards link to polymarket.com (the pre-US fallback). After that scan they should show the US price and "Bet on Polymarket US". **Confirmed by Q (Nov 20):** the engine runs on Railway, not GitHub Actions. Its scans at 21:29 and 21:33 UTC produced about 6,600 US-listed bets. The signed-out landing shows Free data, which runs 15 min behind, so it switches about 15 min after the first US scan. Landing check: PENDING.
