# Overhaul spec (Nov 20, 2026)

Owners' verdict on kismetodds.com: confusing, slow, looks like generic AI output, doesn't sell.
Audience: casual bettors placing 1–2 bets on their phone. Not traders, not statisticians.
Be ambitious: fix the whole experience, not the smallest change that satisfies each line.

Every item has a check. An item is done only when its check passes and the evidence (command output,
numbers, or screenshot path) is pasted under it in `docs/OVERHAUL-REPORT.md`.

## 0. Research first (2–3 subagents in parallel, ~45 min, before lanes A, B, D start)
Use web search and real pages, not memory. Cover:
- **Conversion and landing pages:** what high-converting SaaS and consumer landing pages do above the
  fold, CTA wording and placement, social proof, objection handling, pricing-page layout, free-to-paid
  upgrade prompts, signup friction (Google first, fields, steps). Prefer sources with data
  (A/B tests, CRO case studies, Nielsen Norman Group, Baymard).
- **Value proposition and copy:** how to state what Kismet does in one sentence a casual bettor gets
  instantly (jobs-to-be-done, before/after framing, benefit over feature). Write 3 value propositions
  and test them against the 5-second rule.
- **Showing data to non-experts:** how betting and finance consumer apps (Robinhood, Kalshi,
  Polymarket, Action Network, DraftKings, FanDuel, Rithmm, Cash App) show odds, probabilities, payouts
  and track records simply. Natural frequencies ("7 in 10") vs percentages, star/grade ratings, what
  goes behind a tap.
- **Usability:** Nielsen's heuristics, mobile-first patterns, filter/search patterns for casual users,
  loading states, perceived speed.
- **Trust and compliance:** how gambling-adjacent products present results honestly without leading
  with them.
- Output: `docs/research/overhaul.md` with the 15 rules we follow (each with source links and an
  example to copy), the chosen value proposition, and screenshots of 5 pages to imitate.
- Check: file exists with sources; lanes A, B and D cite its rules in their commits.

## A. First screen and landing page (`/`, signed out)
- First screen at 390×844 and 1440×900 answers in 5 seconds: what it is, who it's for, what to do next.
  One headline, one sentence, one "Sign up free" button, one real bet card in the new style.
- Banned on the landing page: "edge", "spread", "pts", "model", "priced below their record", "$1 share",
  "walk-forward", "EV", "t-stat", any stats table, any chart, any count above 3 digits.
- Below the first screen, in this order: 3 steps in everyday words, 3 real bets, plans, a 5-question FAQ,
  one link "See how we track results" → /track-record.
- Remove the market-says/won-before explainer bars and "Bars use the first best bet below."
- Write 3 headline options; ship the one the research supports; list the other two in the report.
- Check: grep of the rendered `/` HTML finds none of the banned words; screenshots at both sizes in the report.

## B. Cards, Best bets, filters (whole app)
- A bet card shows only: plain title ("Crystal Palace to win", never "Will Crystal Palace FC win on
  2026-11-21?"), "Bet {side}", "Wins about 7 in 10", "$10 wins $5.60", a 1–3 star value rating, closing
  time, "Bet on Polymarket" button. Everything else goes inside a "Why this bet?" expand.
- Free users' locked cards: a solid card with a lock icon and "Unlock N more bets". No fades or blurs
  (on a phone they look like a glitch).
- Best bets page: "Today's top 5" first, then "More bets". No tier or section jargon.
- Filters: one chip row (top 6 sports + More, Today / This week, Safer / Balanced / Bigger payouts);
  the rest behind "More filters". Results update without flashing the old list.
- Check: e2e asserts each card has at most 7 visible text elements outside "Why this bet?"; banned-word
  grep on `/bets` and the card component; before/after screenshots.

## C. Speed (measured, prod)
Measured Nov 20: `/` TTFB 5.3 s cold, 0.8 s warm. Every page returns `cache-control: private, no-store`
and `x-vercel-cache: MISS`. Cold cost = loading and parsing the full markets file on a new instance.
Owners report about 5 s after each click.
- The engine writes small precomputed files each scan (`top.json` with every field cards need,
  `counts.json` with every count shown anywhere, per-category lists). Pages read these, not markets.json.
- Signed-out pages (`/`, `/pricing`, `/about`, `/track-record`, legal) are static + ISR, cached at the
  edge, revalidated on demand by `ops/upload.py` after each upload.
- Signed-in pages: prefetch nav links, render a skeleton instantly, cache everything not per-user.
- Lazy-load charts and the drawer; landing page JS < 150 KB gzipped.
- Check (prod, after deploy, numbers in the report): signed-out pages `x-vercel-cache: HIT`; cold TTFB
  < 500 ms; Lighthouse mobile LCP < 2.0 s, INP < 200 ms, CLS < 0.05 on `/`, `/bets`, `/pricing`,
  `/track-record`. A change with no measured gain doesn't count.

## D. iPhone
- Playwright WebKit at 390×844 and 430×932 on every page: no horizontal scroll, tap targets ≥ 44 px,
  sticky header never covers content, modals and keyboard usable, no loading flashes.
- Check: these viewports run in the e2e suite and pass; screenshots of every page in the report.

## E. Results and the live record (investigate first)
Live ledger: 1,117 settled best bets at −2.2%. Walk-forward backtest: +17%. That gap is the business risk.
- Find out why: entries priced at the real ask after fees? Edge tier mixed in? 90¢+ favourites
  dominating (small wins, big losses)? Categories losing live (weather: 590 settled) that the backtest
  is weak on? Any lookahead in the backtest? Is the big negative May week a data bug?
- Write `docs/research/live-vs-backtest.md`: findings, plus the filter change that would have made live
  match. Ship it behind a flag, default off, and report the numbers with it on and off.
- Placement (owners' call): performance numbers do not lead anywhere. None on the landing page;
  /track-record keeps them, live and test side by side in plain words, never removed or cherry-picked.
  Fix a bad week only if it's a proven data bug, and say so on the page.
- /track-record readability: one headline number per section, one-sentence explanations, no t-stats or
  cents-per-share up front (move them into a "Details" expand). Retitle "Do predicted edges come true?"
  to "Bets we rated higher did better" if the data still says so.
- Check: the research file exists with numbers; /track-record screenshots in the report.

## F. Holes found by review (do these too)
1. **US users and Polymarket US.** Kismet scans international Polymarket (gamma/clob.polymarket.com).
   Most of our customers are in the US, where people trade on the separate CFTC-regulated Polymarket US
   app (its own markets, prices and fees, KYC, not available in every state). Check: which venue a US
   user can actually use; whether Polymarket US has a public market/book API; how its prices and fees
   differ. Write `docs/research/polymarket-us.md`. If US users can't act on our bets, propose and build
   the fix: scan Polymarket US too and send US users there with its prices and fees, or at minimum say
   clearly which venue each bet is on and where it's available. "Bet on Polymarket" must never send a
   US user to a site they can't use.
2. **Stale-data alarm.** The site showed a 10-hour-old scan overnight and nobody knew. Add a check every
   15 min (GitHub Action or Railway job) that reads `/api/meta` and emails kismetodds@gmail.com through
   Resend when the live scan is older than 45 min or the site errors. One email per incident, plus an
   all-clear. Check: forcing a stale timestamp in a test triggers exactly one email.
3. **Funnel tracking.** PostHog is installed. Define and fire these events: landing view, signup start,
   signup done, first Best bets view, first "Bet on Polymarket" click, upgrade view, checkout start,
   trial start, paid. Add an admin page with daily counts and conversion between steps. Check: e2e walks
   the funnel and each event fires once.
4. **Lifecycle emails (Resend):** welcome (how to read a card, 3 lines), trial day 5 "your trial ends
   in 2 days, here's how to cancel", receipt on first charge, and a cancel confirmation. Trial-ending
   reminders are expected by card networks and some state auto-renewal laws. Check: each email
   rendered in a test, links work, unsubscribe where required.

## G. US-first, spread-out live record (owners' priority, added Nov 20 midday)
Read `docs/research/polymarket-us.md` first. In short:
- US users can only trade on Polymarket US.
- 27% of our scan is listed there, all of it sports.
- 53% of the live record is weather, which isn't on Polymarket US.
- On the same bet, a US user pays about 0.6¢ more per share (fee Θ = 0.095).

The **engine part is done** on branch `claude/us-venue` (PR "US venue"). It does F1's research and data work, so
don't redo it: merge that PR into `final` before any lane touches `engine/` or the card components.
- Every market gets `us` (link, side, US ask, fee, edge at US prices) or null.
- `meta.us` reports coverage.
- The ledger logs US prices and grades a separate US record (`ledger_summary.us`), plus `first` (each bet once) and
  `events` / `avg_pnl_by_event` (each game counted once).

1. **Cards and buttons (lane B, card owner).** The site serves the US only (`config/site.json` countries), so:
   - Bets with `us`: the main price, return and button are the US ones. The button reads "Bet on Polymarket US"
     and goes to `us.url`. Small print: "Polymarket US price, incl. its fee".
   - Bets with `us: null`: grey "International only, not on Polymarket US" label. No primary bet button; the
     international link sits in Details with "Not available to US residents".
   - Check: e2e asserts no card's primary button points to polymarket.com when `us` exists, and none exists when
     `us` is null.
2. **Lists (lane B).**
   - New filter "On Polymarket US", **default on** for every tier. Best bets with it on = `us` present and
     `us.edge ≥ meta.rule.min_edge`, ranked by US return.
   - The Free daily 10 are drawn from that set when it has ≥ 10.
   - Counts and headlines use the same set.
   - Check: unit tests on filter + count, screenshot with the default.
3. **/track-record (lane E).**
   - Lead the live section with the US record (`ledger_summary.us`): settled bets, **events**, return. Then the
     whole record, with "including international-only bets US users couldn't place: N (mostly weather)".
   - Base "enough to compare" / `needs` on events, not bets.
   - Use `first` (each bet once) for the headline numbers.
   - Replace "Testing on 1 year of past markets" with the truth: 87% of tested best bets fall in the last 2 test
     weeks and none before Apr 22. Find out why history before September is thin, fix it if it's a data gap, and
     re-run the test.
   - Check: screenshots + `docs/research/live-vs-backtest.md` numbers.
   - Next to the US record: "Kismet's picks vs other bets at the same payout" (`vs_same_payout`), counting events.
   - **Status (lane E, T-296):**
     - Done in `lib/proof.ts`, so /pricing, /about, llms.txt, the MCP tool and /track-record all show it:
       - The span comes from `folds[]`: "past markets from Apr 22 to Nov 14, 87% of bets in the last 2 weeks".
       - "Needs" is counted in events and judged on the US record's events only.
     - /track-record order:
       1. US record.
       2. Same-payout card, which renders once `vs_same_payout` exists. It is gated on events.
       3. Whole record (`first`) with the international-only line.
       4. Test.
     - Thin history: the sample is dense at the end and the model needs warm-up. On an evenly sampled local rebuild
       the last-2-weeks share is 0.9%, not 87%. This is not confirmed on production; the owner must re-run the
       backfill. See research doc §5.
     - Ask pricing, held-out filters and per-event results: research doc §7. Before/after text: research doc §8.
     - Engine-side gap: `vs_same_payout.picks` includes picks from before the control log existed. See §4 of the doc.
4. **US-native scan (engine, after the PR merges).** Politics, culture, crypto and macro on Polymarket US don't
   match international contracts, so score them directly:
   - Run the model on US markets at US prices, with fee 0.095.
   - Category map: politics → politics, culture → culture, crypto → crypto, macro/finance → finance,
     technology → tech.
   - Rows get `venue: "us"` and a US-only link. The ledger records them in the US record.
   - Ship behind `US_NATIVE_SCAN` (default off), report counts and first results with it on.
   - Check: unit tests on a US fixture; `meta.us.native` count.
5. **Spread out (engine).** Report-side weighting is done (`avg_pnl_by_event`).
   - Also cap Best bets to the 2 best lines per game (config `max_best_per_event`, default 2) so one game's 20 lines
     can't flood the list or the record.
   - Report the live numbers with the cap on and off.
6. **Link check.** Confirm `https://polymarket.us/market/<slug>` opens the market in the US app and site
   (iPhone + desktop). If not, find the right pattern and change `US_URL` in `pipeline/venue_us.py`.

## Rules
- Use parallel subagents, one lane per agent, each on its own branch, merged into `final` when green.
  Lanes A, B and D touch the same components: give B the card and filter components, A only the landing
  files, and D fixes layout after A and B merge.
- Don't change prices, plans, the disclaimer, or compliance rules in CLAUDE.md.
- Keep lint, typecheck, unit and e2e green. **Every push to `final` deploys kismetodds.com to production in ~2 min**
  (CLAUDE.md rule 10). Work on lane branches and merge into `final` only finished, green work. Measure lane C on
  prod after its merge deploys.
