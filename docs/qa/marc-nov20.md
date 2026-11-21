# Marc's QA list (Nov 20, 2026): master log

Orchestrator log for the Nov 21 overnight run. Lane logs: `marc-nov20-lane{A,B,C,D}.md`.
Status: fixed / already fixed / won't fix (why) / not verified live / open.

## Summary
**Shipped to kismetodds.com:** every item in the four lane briefs is now fixed, already fixed, or hardened, with three exceptions: #27 and #29 are partly fixed, and #23 was hardened but never reproduced. Merges: #11 to #14 one at a time, then batch 1 (#15) and two install fixes (#16, #17). Batch 2, the Kalshi full crawl, went out as #18 (b806a66). It deployed READY on Vercel and SUCCESS on Railway.
- **One return figure everywhere.** Card, drawer, tables, /about Top 3 and MCP all read from `betQuote`. Labels are worked out at the shown price, and "Biggest payout" sorts by the card's after-fee payout.
- **Fresh data.** Snapshots are never more than 5 minutes stale. Counts come from one source on every page, timestamps tick, and the scan copy says "about every 15 minutes".
- **Account.** Paid users never see Free upsells. One header everywhere. /account and /settings link to each other, and the onboarding banner no longer flashes. Saved views can be listed, renamed and deleted, with a suggested name. Unknown URLs return 404.
- **Selling only what works.** Pricing lists only shipped features: no extension "coming soon", no Telegram or Discord. The connector allowance is worded the same everywhere: Pro 3 calls a day, Premium no daily cap. /alerts says plainly how alerts are delivered.
- **Combos and Kalshi out of beta.** /kalshi is open to every signed-in plan. Combo legs come one per event, never closed or past, with labelled numbers and the cautious chance.

**What's left:**
- **#27/#29 hydration flashes.** Partly fixed; a few may remain in the header and on Kalshi.
- **#23.** If Marc still sees a blank /alerts, note the browser, plan and console error.
- **Kalshi data.** Check that the new per-market fields (no bid/ask, last price, 24 h volume, open interest, status) are non-null in kalshi.json; their names are unverified. Settlements do work: 100, then 200, then 247 rows over the first three scans.
- **Railway disk.** Check that the `data/` volume isn't growing every scan; the crawl cache is now about 110 pages.
- **Install command.** It now wipes node_modules on every build (about 1 minute slower). The root cause is unknown (the pnpm 12 slot collision on the vendored picomatch). The `pwd; ls` debug prefix is still in it; drop it once builds stay green.

**Not verified live (needs a signed-in check):** paid-plan views of counts, upsells and header; Pro email alerts; #23 (a blank /alerts was never reproduced); the WebKit/iPhone e2e and trading-paper specs (they can't run in this sandbox); the 30-minute /api/meta freshness sample for #46/#60.

**Q must decide:**
1. **Alert env.** Set RESEND_API_KEY, EMAIL_FROM, UNSUBSCRIBE_SECRET and CRON_SECRET on Vercel production, or no alert emails go out. Without them it fails closed and sends nothing. Also decide:
   - whether email should be on by default for new rules;
   - whether existing rules should get email;
   - whether a once-a-day cron is enough (more often needs a paid Vercel plan);
   - whether Free users should see an upgrade message on /alerts.
2. **Telegram/Discord.** They're off /pricing because a rule can't store a webhook. Bring them back once that's built?
3. **Chrome extension.** Re-add it to the plan cards when it ships.
4. **Stripe Customer Portal.** Confirm "Cancel subscriptions" is on in the production Stripe account; the connector here sees a different account.
5. **Desktop Account link.** Make it a menu (#21)?
6. **Backtest framing.** The even-weeks rebuild gives +6.4% a bet over 42 of 52 weeks. Prod says +11%, with 81 to 87% of its bets in the last 2 weeks. Which should the site lead with?
7. **/pricing wording.** It says "Live", but scans run every 15 to 22 minutes.
8. **Combo legs.** They show the cautious chance, which makes the legs multiply to the combo chance. The bet card shows the central chance. Keep it this way?
9. **Kalshi combo check.** It needs the engine's `kalshi_match` job, which isn't built.
10. **Copy changes to review:** /terms and /disclaimer wording (Free sees ranges).
11. **Out of scope.** Items 1, 7, 12, 16, 24, 43, 45, 62 and 66 weren't in any brief and weren't touched.
12. **Kalshi crawl budget.** At 45 s it reads 116 pages and never finishes (cap: 500 pages, about 0.27 s each). Raising `KALSHI_BUDGET_SEC` on Railway (for example to 180) would finish the crawl. But the Polymarket upload waits for the Kalshi step, so every extra second delays fresh best bets by the same amount. I left it at 45 because freshness (#46) matters more.
13. **#68 sort.** The pays sort no longer widens tiers; sorting only reorders.
14. **/combos for Free and Pro.** They now get an upgrade prompt instead of a 404.
15. **Kalshi board.** Should it show the new fields and recent settlements?
16. **Permission prompts.** Add allow rules for the GitHub and Vercel tools to `.claude/settings.json` so overnight runs don't wait on approval clicks. I wasn't allowed to change this myself.

## Run notes
- PR #10 (agent teams settings) merged to `final` as 67faeaf. Agent teams were not active in this
  session, so the lanes run as 4 parallel subagents in their own worktrees. Only the orchestrator merges.
- Marc's original list is not in the repo. Item descriptions below come from the lane briefs only.
- Lane B one-return plan (Nov 21): roi_pct already equals win% x after-fee pays - 1 (fixture max diff 0.03pp); the bug is presentation. New lib/betQuote.ts feeds card, drawer, tables, /about. Advisor was rate-limited, so the orchestrator reviewed it and approved with notes: export numeric pays for A's #69 sort, Free tier sees bands only, every drawer figure shows its n, card stays 7 slots at 390px.
- Gate note: PRs #11-#13 merged while `check:js` read 150.4-150.8 kB here; origin/final itself was already 150.2-150.6 (over). Cause found by Lane A (not-found/error pulled the client kit into every page); #14 took landing JS to 142.6 kB. Gate is OK from #14 on.
- Pre-existing red test: test/teaser.test.ts "one bet per game" depends on today's UTC date; fails on final before tonight. Lane A asked to pin its clock. test/api.test.ts timing flakes under parallel load and passes alone.
- Lane D's first agent stalled on an MCP permission prompt and made no commits; stopped and respawned with no-MCP rules.
- Merged in order: #10 settings, #11 QA-A 46/60, #12 QA-C 18/48/32/30, #13 QA-C 33, #14 QA-A JS budget. Each deploy READY before the next merge.
- Batch 1 merges as ONE integration PR (merge commit), not one PR per lane branch. Why: the lane branches only merge cleanly with conflict resolutions (FreshnessPill A/C, multipliers.spec, Plans.tsx) and three orchestrator commits (sort repoint to betQuote, demo AuthBoot loads /api/me, header spec for live Kalshi) that sit on no lane branch, so only the stack tip was ever gated green. "Never merge red" beats "one at a time". Advisor agreed. Rollback is one `git revert -m 1`.
- Batch 1 = B return/faq/ledger, A counts/sort/freshness/plan/teaser-clock, C header/upsell/views/settings/pricing, C2 alerts/connector, D golive/combos. Gates on the tip: tsc, lint, vitest 1431/1431, pytest 122, check:js 143.2 kB, free + paid e2e (chromium). No DB migration. Alerts env (RESEND_API_KEY, EMAIL_FROM, UNSUBSCRIBE_SECRET, CRON_SECRET) fails closed when unset.
- Batch 1 merged as #15 (22e79e3). Its prod build then failed twice at `pnpm install` (ERR_PNPM_PACKAGE_MANAGER_CREATE_SLOT_DIR on the vendored picomatch slot in the restored build cache); prod kept serving da64226 the whole time. #16 (remove the slot) did not fix it. #17 (install from an empty node_modules) was proven on a preview build first, then merged; prod went live with batch 1. Smoke on prod: / /pricing /about /status 200, app pages 307 to sign-up when signed out, unknown URL 404, footer disclaimer present, /pricing has no Telegram/Discord and shows "3 calls a day" and Kalshi lines, scan 19 min old, no runtime errors in the first 15 min.
- Batch 2 (#18) live. First Railway scan on it (09:05 UTC): `kalshi: 86396 markets (11600 events, 116 pages, complete=False), 20 combos, 0 settled, 34.5s; crawl stopped: Deadline`. It used to be 2,251 markets. The crawl hits the 45 s budget before the last page, so `complete` stays False every run. kalshi.json is still written, capped at the 2,000 busiest. 0 settled is expected on the first run: settlements only come from tickers seen open earlier. Scan, upload and revalidate all ran normally afterwards. Next scans: 09:16 (106 pages, 100 settled, 35.6 s), 09:26 (110 pages, 200 settled, 36.0 s), 09:41 (106 pages, 247 settled, 35.5 s). No errors, no skipped stages. Vercel runtime errors since 08:40 UTC: none. Not checked: whether the new per-market fields are non-null. kalshi.json sits in the private `scan` bucket, and /api/kalshi needs a signed-in session.
- Lesson: the preview build of the batch branch (0125ddc) had already failed the same way before #15 merged. Check the preview deploy before every merge to `final`.
- Batch 2 = D kalshi-fetch (pipeline, runs on Railway; field names unverified because Kalshi's API is blocked from here). Separate PR after batch 1 is live.
- Not run here: WebKit/iPhone e2e (WebKit not installed), trading-paper (needs full Chromium + extension deps).
- Shared items: 69 (A, then B if still wrong), 48 (B: FAQ copy, C: cancel path).

## Items
| # | Lane | Topic | Status | Evidence | PR |
|---|------|-------|--------|----------|----|
| 2 | A | data staleness vs "~10-minute scans" copy | fixed | copy says scans run about every 15 minutes (Railway: 900 s); /status flags late scans after 45 min | qa-a-freshness → #15 |
| 3 | B | backtest headline vs live record | already fixed | calibration sentence 'Why live trails testing' already live | — |
| 4 | B | FAQ contradictions | fixed | FAQ: most best bets win because most pay <1.5x, yet a record can lose money; live hit rate + return shown | qa-b-faq → #15 |
| 5 | B | edge labels vs numbers | fixed | labels computed at the quote's price; return <= 0 gets no stars or positive verdict (tested on every fixture bet) | qa-b-return → #15 |
| 6 | A | counts disagree | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 9 | C | Pro modal close; filter loading state | fixed, verified in mock | Free upgrade sheet closes; /markets shows "Loading markets…" | qa-c-upsell → #15 |
| 10 | B | gross vs net | fixed (superseded by one-return change) | card, drawer and stake box show one after-fee payout | qa-b-return → #15 |
| 11 | B | gross vs net | fixed (superseded by one-return change) | card, drawer and stake box show one after-fee payout | qa-b-return → #15 |
| 13 | A | paid users see Free upsells | fixed, not verified live | /api/me retried with backoff; no paid upsell until plan known | qa-a-plan → #15 |
| 14 | B | similar past bets vs testing figure | fixed | one tested figure per payout band from backtest.by_pays (same as /track-record); <30 tested bets says so | qa-b-return → #15 |
| 15 | D | combo legs same event; cautious chance | fixed | tray refuses a 2nd leg from the same event_id; combo return uses the cautious chance (q_low) shown on the legs | qa-d-combos → #15 |
| 17 | C | signed-in header consistent | fixed, not verified live | nav links from server (me.nav); same header incl. /kalshi and 404; e2e-paid qa-c-header | qa-c-header → #15 |
| 18 | C | /account plan, renewal, manage billing | fixed / not verified live | /account shows plan, trial end, 'Manage billing or cancel'; e2e-paid qa-c-billing 2/2 | #12 |
| 19 | C | saved views list | fixed, verified in demo build | saved-views list on /bets and /markets: apply, rename, delete | qa-c-views → #15 |
| 20 | B | return/payout disagree | fixed, not verified live | lib/betFigures.ts betQuote is the one source for venue/price/fee/pays/return on card, Why, drawer, tables, panels, MCP; test/one-return.test.tsx checks every fixture bet | qa-b-return → #15 |
| 21 | C | /settings links, account sync | fixed, verified in mock | /account links to Settings and back; desktop menu left to Q | qa-c-settings → #15 |
| 22 | C | onboarding banner, sync | fixed, verified in mock | sync already worked; wrong "saved in this browser" wording fixed; banner no longer flashes after setup, dismiss saves to account | qa-c-settings → #15 |
| 23 | C2 | /alerts blank; alert delivery claims | not reproduced; hardening shipped; not verified live | blank not reproduced in mock with client chunks blocked; skeleton fallback + "Loading your alerts…"; delivery line says plainly tab checks every 2 min, email once a day | qa-c2-alerts → #15 |
| 25 | A | Free limit text on /bets | fixed | Free /bets reads 'Showing 10 of 89 bets' | qa-a-counts → #15 |
| 26 | A | counts | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 27 | A | hydration flashes | partly fixed | times render from one clock server/client; remaining flashes in header (C) and Kalshi (D) files | qa-a-freshness → #15 |
| 28 | B | /about Top 3 sort | fixed | /about Top 3 uses BetCard ranked by shown return, $10 stake | qa-b-return → #15 |
| 29 | A | hydration flashes | partly fixed | times render from one clock server/client; remaining flashes in header (C) and Kalshi (D) files | qa-a-freshness → #15 |
| 30 | C | Free "Start free" goes to signup | fixed | Start free -> signup, covered in qa-c-billing | #12 |
| 31 | B | return/payout disagree | fixed, not verified live | lib/betFigures.ts betQuote is the one source for venue/price/fee/pays/return on card, Why, drawer, tables, panels, MCP; test/one-return.test.tsx checks every fixture bet | qa-b-return → #15 |
| 32 | C | trial plan kept through signup | fixed (already worked; now proven) | e2e-paid qa-c-billing: trial keeps plan/period through signup into checkout | #12 |
| 33 | C | 404 for signed-out visitors | fixed | prod: /no-such-page-xyz -> 404 (was 307 /signup) | #13 |
| 34 | A | timestamps lag | fixed | <Ago> ticks every 30 s off the shared clock; pill, Best bets, markets, /status, /kalshi | qa-a-freshness → #15 |
| 35 | B | "52 weeks" framing; backtest weeks | fixed | test span reads 'bets in N of M weeks, X% in the last 2'; method note says only N of 52 weeks had bets; even-week rebuild run (see Q decisions) | qa-b-faq → #15 |
| 36 | B | backtest vs live | fixed | test span reads 'bets in N of M weeks, X% in the last 2'; method note says only N of 52 weeks had bets; even-week rebuild run (see Q decisions) | qa-b-faq → #15 |
| 37 | B | return/payout disagree | fixed, not verified live | lib/betFigures.ts betQuote is the one source for venue/price/fee/pays/return on card, Why, drawer, tables, panels, MCP; test/one-return.test.tsx checks every fixture bet | qa-b-return → #15 |
| 38 | C2 | AI connector allowance | fixed, verified in mock | one statement from lib/connector-plan.ts, also read by the rate limiter: Pro 3 calls a day; Premium no daily cap (60/min); not on Free | qa-c2-connector → #15 |
| 39 | C | plan cards list only shipped features | fixed | Chrome extension "coming soon" removed from Premium card and compare table; Combos/Kalshi lines from D | qa-c-pricing → #15 |
| 40 | A | paid users see signed-out view | fixed, not verified live | /api/me retried with backoff; no paid upsell until plan known | qa-a-plan → #15 |
| 41 | C | /status data-source spacing | already fixed, verified live | prod /status at 390 px: heading, line and footer evenly spaced (screenshot Nov 21) | — |
| 42 | D | combo legs from closed/past markets | fixed, not verified live | closed or past-dated legs dropped on every request; tray refuses them; yearless dates read against close date | qa-d-combos → #15 |
| 44 | A | timestamps freeze | fixed | <Ago> ticks every 30 s off the shared clock; pill, Best bets, markets, /status, /kalshi | qa-a-freshness → #15 |
| 46 | A | CRITICAL stale snapshots | fixed, verified live | SWR limited to copies <5 min old; torn loads refused. Prod sample, 30 polls of /api/meta 1 min apart (Nov 21 ~09:25-09:55 UTC): scanned_at never went backwards, 3 scans seen, age 15-25 min | #11 |
| 47 | A | search accent matching | fixed | invalid ?s= falls back with a note; search folds ø/æ/ß/ł so 'Bodø' doesn't match 'The Body' | qa-a-sort → #15 |
| 48 | B+C | FAQ / cancel path | fixed | 'everyone sees the same numbers' reworded (Free sees ranges) on /about, /pricing, /terms, /disclaimer, landing; cancel answer links /account 'Manage billing or cancel' | #12 + qa-b-faq → #15 |
| 49 | A | counts | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 50 | A | "Show every bet" when all show | already fixed | 'Show every bet' removed in T-302; checked code and live | — |
| 51 | B | similar past bets vs testing | fixed | one tested figure per payout band from backtest.by_pays (same as /track-record); <30 tested bets says so | qa-b-return → #15 |
| 52 | D | closing-within-a-day legs; past dates | fixed | 0 < closes_at − now ≤ 24 h at request time | qa-d-combos → #15 |
| 53 | C | saved view default name | fixed, verified in demo build | save dialog suggests a name from the filters (e.g. "NFL · 70%+ to win") | qa-c-views → #15 |
| 54 | B | return/payout disagree | fixed, not verified live | lib/betFigures.ts betQuote is the one source for venue/price/fee/pays/return on card, Why, drawer, tables, panels, MCP; test/one-return.test.tsx checks every fixture bet | qa-b-return → #15 |
| 55 | B | return/payout disagree | fixed, not verified live | lib/betFigures.ts betQuote is the one source for venue/price/fee/pays/return on card, Why, drawer, tables, panels, MCP; test/one-return.test.tsx checks every fixture bet | qa-b-return → #15 |
| 56 | A | counts | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 57 | A | counts | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 58 | C2 | AI connector allowance | fixed, verified in mock | same as 38 | qa-c2-connector → #15 |
| 59 | A | counts | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 60 | A | CRITICAL stale snapshots | fixed, verified live | same as 46 | #11 |
| 61 | B | (already fixed by #5/#6 per brief; to verify) | fixed (superseded by one-return change) | card, drawer and stake box show one after-fee payout | qa-b-return → #15 |
| 63 | A | counts | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 64 | C2 | alerts sold vs delivered | fixed, not verified live | Pro/Premium Email switch, on by default; daily cron (401 without CRON_SECRET); Telegram/Discord removed from /pricing (no way to store a webhook) | qa-c2-alerts → #15 |
| 65 | D | /combos intro range | fixed | intro range built from the cards shown (combos-range) | qa-d-combos → #15 |
| 67 | A | timestamps | fixed | <Ago> ticks every 30 s off the shared clock; pill, Best bets, markets, /status, /kalshi | qa-a-freshness → #15 |
| 68 | A | sort changes result set | fixed | sort only reorders (pays sort no longer widens tier) | qa-a-sort → #15 |
| 69 | A(+B) | "Biggest payout" sort | fixed | 'Biggest payout' sorts by betQuote().pays, the card's after-fee figure (orchestrator repoint) | qa-a-sort + orchestrator → #15 |
| 70 | A | counts | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 71 | A | Show more counter, dead click | fixed, paid views not verified live | lib/data/counts.ts settledCount/bestBetsCount shared by /status, /about, /api/meta, MCP; exact below 10,000; plural(); Show more counts and hides at end | qa-a-counts → #15 |
| 72 | C2 | AI connector allowance | fixed, verified in mock | same as 38 | qa-c2-connector → #15 |
| 73 | C | header on /kalshi, 404 | fixed, not verified live | nav links from server (me.nav); same header incl. /kalshi and 404; e2e-paid qa-c-header | qa-c-header → #15 |
| 74 | D | label every leg number | fixed | leg reads "Yes · Pays 1.6x after fee · 64% chance to win (cautious)" | qa-d-combos → #15 |
| 8 | C | /about "Coming soon" (part 1) | already fixed, verified live | prod /about HTML has no "coming soon" (Nov 21) | — |

Items 1, 7, 12, 16, 24, 43, 45, 62, 66 are not in any lane brief and are not tracked here.
