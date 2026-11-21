# Polish round, research notes 2 (P2, P5, P6, P7, P9)

Research only, no app code changed. Written Nov 19, 2026 against `final` @ e213f0a and the live site
https://kismetodds.com (signed out, Stripe test mode). Spec: `docs/19-polish-round.md`.
Claims marked *unverified* came from search snippets or third-party copies, not a page I read in full.

---

## P2 first-run tour research

### What good products do

| Product | Pattern | Source |
|---|---|---|
| Linear | About 7 quick setup screens in roughly a minute. No tour: it ends on an empty first issue and lets the product teach itself. Learning lives outside the app (demo workspace, start guide, live sessions). | [Candu teardown](https://www.candu.ai/blog/linear-onboarding-teardown), [Linear start guide](https://linear.app/docs/start-guide) |
| Notion | 4-step signup with progress; steps 3–4 are optional. The workspace opens on a "Getting Started" page that is itself a checklist you tick by doing ("Type / for commands"). | [Appcues GoodUX: Notion](https://goodux.appcues.com/blog/notions-lightweight-onboarding) |
| Duolingo | Product first: the first lesson comes before signup. Moving signup after the first lesson gave about +20% DAU. "Soft walls" with a quiet "Later" beat hard walls (+8.2% DAU from tuning them). | [Appcues GoodUX: Duolingo](https://goodux.appcues.com/blog/duolingo-user-onboarding), [First Round: Duolingo growth](https://review.firstround.com/the-tenets-of-a-b-testing-from-duolingos-master-growth-hacker) |
| Robinhood | Short animated cards with a progress indicator and reassurance on sensitive steps. Deeper teaching sits in a separate hub (Robinhood Learn), not in a tour. | [Google Design: Robinhood](https://design.google/library/robinhood-investing-material), [Robinhood Learn](https://robinhood.com/us/en/learn/) |
| Figma | 5-step popup tour ("5 of 5") plus tips that appear when the user's own action triggers them. Figma removed its "Reset onboarding" replay in 2024. | [Chameleon: Figma tour](https://www.chameleon.io/inspiration/figmas-onboarding-tour), [Figma forum](https://forum.figma.com/ask-the-community-7/how-to-reset-the-pop-up-of-new-feature-5316), [NN/g](https://www.nngroup.com/articles/onboarding-tutorials/) |
| Slack | You learn by doing (Slackbot prompts you to send a message). Tooltips are brief and the tour can be ended at any step. A final modal asks for notification permission. | [Appcues GoodUX: Slack](https://goodux.appcues.com/blog/slacks-new-user-onboarding) |

### Rules the evidence supports
1. **People skip tutorials.** Help that is in context, easy to dismiss and easy to find again beats front-loaded tours ([NN/g, onboarding tutorials](https://www.nngroup.com/articles/onboarding-tutorials/)).
2. **Tours can make an app feel harder.** In NN/g's study of 70 users, task success was 91% with a tutorial and 94% without. Ease ratings dropped from 5.49 to 4.92 ([NN/g, mobile tutorials](https://www.nngroup.com/articles/mobile-tutorials/)).
3. **Keep it short.** Median completion: 73% for 1–2 steps, 38% for 3–5, 25% for 6–8, 8% for 9+ ([Produktly 2026 benchmarks](https://produktly.com/research/saas-onboarding-benchmarks-2026)). Chameleon: 3–4 steps finish about 72–74%, 7+ steps about 16% ([Chameleon](https://www.chameleon.io/blog/mastering-product-tours)).
4. **Let the user start the tour.** Tours the user chose to start, or launched from a checklist, finish 67–69% of the time; auto-started or delay-triggered tours finish 23–31% (same two sources).
5. **One idea per coach mark,** shown on first contact with that feature, styled so it doesn't look like a real control ([NN/g, instructional overlays](https://www.nngroup.com/articles/mobile-instructional-overlay/), *fetched as summary only*).
6. **Skip on every step, and ask for commitment late** (Duolingo soft walls).

### What exists today
`/onboarding` (`apps/web/components/onboarding/Onboarding.tsx`) has 3 full-page steps: topics, default stake, and a short tour. Finishing or skipping sets `profiles.onboarded_at` (line 59). `OnboardingNudge.tsx` shows the "Choose your topics" banner on Best bets. The app has no spotlight on the real UI and no replay.

### Proposed tour spec for Kismet
**Shape.** Keep the 2 setup steps (topics, stake) as they are. Replace the "short tour" step with an **opt-in spotlight tour on the real Best bets page**, plus a **4-item checklist** card. The tour has 5 steps. It is never auto-started over the data: after onboarding the user lands on Best bets, and a small card says "Take the 40-second tour · Skip". The tour can be replayed from the account menu ("Replay tour") and from `?` (shortcuts dialog).

Each step dims the page, cuts out the target element, and shows a popover with one sentence, a step dot (1/5), **Next**, and **Skip tour**. Esc also skips. The tour never blocks a click on the highlighted element. Store `profiles.tour_done_at` (or reuse `onboarded_at` plus a `tour` flag in profile settings) so it never auto-shows twice.

| # | Target (selector today) | Copy (one sentence) | Done when |
|---|---|---|---|
| 1 | First `article[data-row]` (`components/market/BetCard.tsx:32`) | "Each card is one bet: what it pays, how often bets like it won, and the price you'd pay. Tap it for the full check." | Next |
| 2 | Pays pill (`components/search/FilterPills.tsx:227`) and the Pays 2x+/5x+/10x+ chips (`components/screener/BestBets.tsx:71`) | "Want bigger payouts? Pick a band here. Long shots lose more often; the card shows their record." | Next, or the user picks a band |
| 3 | Search (`components/search/SearchCombobox.tsx`, header) | "Type a team, a city or '3x' to find bets fast. Press / from anywhere." | Next, or the user focuses search |
| 4 | Star + bell on the card (`WatchStar`, `AlertLink` in `BetCard.tsx:41-42`) | "Star a bet to keep it in My list. The bell alerts you when the price moves (Pro)." | Next |
| 5 | "Results" nav tab (`components/shell/nav.ts:7`) | "Every number here comes from the backtest. See how past best bets did, including the losers." | Finish, which opens nothing; a link says "See results" |

**Checklist** (dismissible card above the list; each item ticks itself when the user does the thing): pick topics · open a bet's full check · star a bet · look at Results. It is hidden once all 4 are done or the user dismisses it. Each tick fires a PostHog event so completion can be measured.

**Build notes.** No library is needed: one absolutely positioned popover plus a `box-shadow: 0 0 0 9999px rgb(0 0 0 / .6)` cut-out on the target's `getBoundingClientRect()`. Step targets use `data-tour="card|pays|search|save|results"` attributes so restyling doesn't break the tour. On mobile, step 5 targets the bottom nav (`components/shell/MobileNav.tsx`).

---

## P7 UI patterns

The patterns come from Robinhood, Kalshi, Polymarket, Linear and Stripe. I found no checkable first-party design source for Arc, so it is left out. Stats are from a grep of `apps/web/components`. At present there is no icon library in `apps/web/package.json`: icons are hand-drawn `<svg>` plus text glyphs (→ ×20, ↗ ×5, × ×4, ✓ ×2). Font sizes in use: `text-sm` ×214, `text-xs` ×187, `text-[13px]` ×74, `text-[15px]` ×19, and 10 other arbitrary px sizes (11, 17, 26, 28, 32, 34, 40…). There are 189 bare `border`, 121 `border-border`, 43 `rounded-full`, and 226 uses of `text-accent*` / `bg-accent*`.

1. **One accent, used for action and "good" only.** Robinhood's identity is mostly neutrals with a single accent used in "purposeful pops" ([Robinhood newsroom](https://robinhood.com/us/en/newsroom/a-new-visual-identity)). Linear limits its brand color to keep the UI neutral ([Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)).
   *Check:* only the primary button, the active nav item and positive numbers are green.
   *Change:* `app/globals.css:14-24` defines both `--accent #10b981` and `--positive #22c55e`, two greens side by side; use one. On the card, the accent appears on the price-verdict line (`BetCard.tsx:78`, `text-accent-softer`), the New pill (`:37`) and the hover border (`:33`). Make the verdict line `text-soft` and keep green for the return number only.

2. **Tabular numerals on every number that changes, numeric columns right-aligned** ([MDN font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)).
   *Check:* no column or price jitters when values update.
   *Change:* only 25 component files use `tabular-nums`. Put `font-variant-numeric: tabular-nums` on `body` in `app/globals.css` (Inter supports it). Then delete the per-span `tabular-nums` classes. "Pays 1.3x" in `BetCard.tsx:63` currently has none.

3. **A small type scale.** Linear uses a display face for headings only, with Inter for everything else ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
   *Check:* 6 sizes at most, e.g. 12 / 13 / 15 / 20 / 28 / 40.
   *Change:* replace the arbitrary `text-[11px]`, `[17px]`, `[26px]`, `[32px]`, `[34px]` values with Tailwind theme tokens (`--text-*` in `globals.css @theme`). The card headline `text-[32px]` (`BetCard.tsx:63`) becomes the 28 step.

4. **Fewer pills: at most one tag per card, for state only.** Polymarket cards show title, outcomes, volume and at most one tag ([polymarket.com](https://polymarket.com)).
   *Check:* count `rounded-full` chips on one card.
   *Change:* a card can show today the topic pill, New, "Lower confidence", the chance pill and "+N more in this game", up to 5 (`BetCard.tsx:36,37,38,92`). Make the topic plain muted text (drop `rounded-full bg-muted-bg`). Drop the chance pill because "wins about 9 in 10" already says it. Keep a single state tag (New *or* Lower confidence). On Best bets, the "523 fair fill / 97 spread eats most of it" chips (`BestBets.tsx:42`) are jargon pills; move them behind the price-check filter.

5. **Separate with surfaces and spacing, not borders.** Linear uses LCH surface levels ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)). Refactoring UI says "use fewer borders" ([refactoringui.com](https://refactoringui.com/)).
   *Check:* a card has either a border or a different background, never both plus inner rules.
   *Change:* `kit/index.tsx:6-7`, where `card` and `inner` both add `border border-border` on top of a surface color. Drop the border on `card` (the `--surface` vs `--background` step already separates it) and keep a border only on inputs. Drop the inner `border-t` footer rule at `BetCard.tsx:89`.

6. **A consistent 4/8-pt spacing grid** ([Material spacing](https://material.io/design/layout/spacing-methods.html)).
   *Check:* no 2.5 / 1.5 / `[3px]` steps.
   *Change:* `gap-1.5` ×59, `gap-2.5` ×16, `px-2.5` ×16, `py-2.5` ×18, `py-[3px]` and `py-[2px]` (`BetCard.tsx:36-37,92`). Snap them to 1/2/3/4/6 (4, 8, 12, 16, 24 px). The header uses `gap-x-7` (`Header.tsx:27`); make it 6 or 8.

7. **One real icon set, 16 px inline and 20 px in nav, `currentColor`, with text labels on key actions.** Stripe Apps icons come in 12/16/20/32 px and take the color of the text around them ([Stripe icon docs](https://docs.stripe.com/stripe-apps/components/icon.md?app-sdk-version=9)).
   *Change:* add `lucide-react` (tree-shaken, about 1 KB per icon). Replace the inline `<svg>`s in `Bell.tsx`, `WatchStar.tsx`, `AlertLink` (`market/bits.tsx:87`), `TradeButton.tsx`, `MobileNav.tsx` and `FilterPanel.tsx`. Replace the "→ ↗ ×" glyphs with `ArrowRight`, `ExternalLink` and `X`.

8. **Show the price as both cents and chance; put the price you pay on the button.** Kalshi: "a 70% chance means Yes costs 70¢" ([Kalshi help](https://help.kalshi.com/markets/markets-101/how-are-prices-determined)). Polymarket shows the midpoint but you pay the ask ([Polymarket docs](https://docs.polymarket.com/concepts/prices-orderbook)).
   *Change:* the card says "Bet No at 75¢" while the drawer says "Bet No at 83¢ live" for the same market (seen on prod, Nov 19). When `useLiveAsk` has a value, the card should show the live price with the scan price struck through (`BetCard.tsx:68-76`), and "Pays" should be recomputed from it.

9. **Clear hierarchy: one big number per card, everything else secondary.** Ström-Awn defines density as value per time and space ([UI density](https://mattstromawn.com/writing/ui-density/)).
   *Check:* squint test, where only "Pays 1.3x" and the question stand out.
   *Change:* today the card shows "Pays", "wins about", "Bet … at", the price verdict, "Estimated return", OddsBars ("Market says / Won before"), Notes and "$100 → …". That is the same edge said 4 ways (`BetCard.tsx:61-90`). Keep Pays + wins + price + the return. Move OddsBars and "$100 →" into the drawer.

10. **Keyboard: Cmd+K for search, `?` for a cheat sheet, `j/k` to move through the list.** Linear documents Cmd/Ctrl+K and a `?` help sheet ([Linear navigating guide](https://linear.app/enablement/guide/navigating-linear), [Linear changelog 2021](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help)).
    *Change:* `components/keyboard/Shortcuts.tsx` already has `?` (line 19). Add Cmd+K as an alias of `/` and show the hint inside the search box (the desktop box shows "/" only). Add `j/k` + Enter to move through and open cards. List these in the tour's last popover.

11. **A persistent nav with a clear current page, and breadcrumbs on detail pages.**
    *Change:* `components/shell/nav.ts:2-19`. Signed-out visitors see "My list" and "My bets" tabs that lead to login. Show them only when signed in, and add "Sign up" (spec P2). "My bets" and "Results" appear in both `MAIN_TABS` and `MORE_LINKS`. `/m/[id]` has no breadcrumb; add "Best bets › NFL › Lions vs. Bucs".

12. **Loading states that keep the layout and answer fast (< 100 ms or a skeleton)** ([UI density](https://mattstromawn.com/writing/ui-density/)).
    *Change:* on a phone, `/markets` showed "Loading markets…" with skeletons for over 3 s. A card click took more than 3 s to show the drawer (P6 explains why). Server-render the first page (see P6 fix 4).

---

## P6 speed baseline

### Measurements (Nov 19, 13:02 EST, from macOS on a home connection, `curl -w`, 6 runs each)
Run 1 added `?cb=…`, but since nothing is cached it only means a fresh TLS connection (its TLS time was about 2× the others). It is not a true function cold start. Runs 2–6 are warm. Every page answered `cache-control: private, no-cache, no-store` and `x-vercel-cache: MISS`, so nothing is CDN-cached.

| Path | First request (new connection) | Warm TTFB median (min–max) | HTML size |
|---|---|---|---|
| `/` | 812 ms | **287 ms** (209–568) | 70 KB |
| `/markets` | 256 ms | **234 ms** (214–270) | 68 KB |
| `/pricing` | 187 ms | **225 ms** (196–228) | 53 KB |
| `/m/6671884` | 335 ms | **330 ms** (241–483) | 43 KB |
| `/api/flags` | 348 ms | 244 ms (185–344), **403** "Automated access is not allowed." | — |

`/api/flags` cannot be timed from curl: BotID refuses any client that has not run the browser challenge, even with a Chrome user agent. Time it from a browser with Speed Insights or a `Server-Timing` header instead. TLS plus connect accounts for about 60–200 ms of each number above; server time is roughly TTFB minus `time_appconnect`.

**Lighthouse 13.6, mobile, `/`** (cached `npx` install run directly with `node …/lighthouse/cli`; plain `npx lighthouse` refused to install the newer version):
performance **72**, FCP/LCP 0.9 s (the LCP element is the headline, because cards arrive later), **TBT 900 ms**, **Speed Index 8.3 s**, TTI 3.2 s, server response 80 ms, total 354 KB.
Main-thread work was 2.4 s. The biggest items:
- **`…/a-4-a/c.js`**: one 586 ms long task. This is *inferred* to be the BotID challenge script: the URL doesn't name it, but it is the only third-party script `initBotId()` loads.
- **`_next/static/chunks/7384-*.js`** (80 KB): 729 ms of script work, of which 40 KB is unused.

Targets in the spec are TTFB < 300 ms (cached), route change < 150 ms and filter change < 100 ms. `/` and `/m/*` miss the TTFB target, and the cards themselves land far later than TTFB (Speed Index 8.3 s).

### Top 5 likely speed fixes
1. **The data store has no stale-while-revalidate: every 120 s one request waits for a full reload.**
   `apps/web/lib/data/store.ts:221-235`. When the TTL expires, `getStore()` starts `loadRaw()`. That downloads markets.json (26 MB) plus 5 more files from Supabase Storage, parses them, and runs `buildStore` (derive + search index). The caller awaits all of it (`state.cache ? state.inflight.catch(...)`). One curl sample can't separate this from TLS or a function cold start, so add a `Server-Timing: store;dur=…` header to measure it.
   *Fix:* if `state.cache` exists, return it at once and refresh in the background. Also skip the rebuild when `meta.scanned_at` hasn't changed: fetch flags.json meta or an ETag first, because scans are hourly at best and the TTL is 2 min. The same applies to the Free-tier cold path, which loads the `*-prev.json` copies inline (`store.ts:272-288`).

2. **Best bets cards are fetched after hydration and behind BotID, so the server computes the page twice.**
   `apps/web/app/page.tsx:14` calls `flagsTotal()`, which runs the full `marketsPage()` and keeps only `.total` (`lib/data/respond.ts:178-186`). The client then fetches the same rows from `/api/flags` (`components/screener/BestBets.tsx:151-154`), which must first pass the BotID challenge (`instrumentation-client.ts:18-29`). That is why LCP is the headline and Speed Index is 8.3 s.
   *Fix:* return the first page of gated rows from `flagsTotal` (rename it `flagsFirstPage`) and pass them as `initialData` to `BestBets`. Do the same on `/markets` (`MarketsScreener.tsx`). Client fetches then happen only on filter changes.

3. **The BotID client script runs on every page load: a 586 ms long task.**
   `apps/web/instrumentation-client.ts:17-30` calls `initBotId()` at startup on every route, including `/pricing`, `/about` and legal pages.
   *Fix:* once fix 2 lands, a plain page view makes no protected call. Start BotID lazily inside `whenIdle()` (same file, line 10), or call it just before the first protected fetch. The spec already says "no blocking BotID on plain page loads".

4. **Every page renders dynamically and nothing is CDN-cached, even static pages.**
   `apps/web/app/layout.tsx:24` sets `export const dynamic = "force-dynamic"` because the CSP nonce is per request (`middleware.ts:40`, `csp()` at :20). As a result `/pricing`, `/about`, `/terms`, `/privacy` and `/track-record` are SSR'd on each hit, with `no-store`.
   *Fix:* use a hash-based or `'strict-dynamic'`-only CSP for static routes (Next 15 supports SRI via `experimental.sri`). Mark those pages `revalidate = 300` and send `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`. Read APIs that are the same for every user of a tier, such as `/api/backtest` and `/api/meta`, can also use `s-maxage` + `stale-while-revalidate` with `Vary` on a tier cookie.

5. **A signed-in request can make 3–5 serial network calls before touching data.**
   - `middleware.ts:67` calls `supabase.auth.getUser()`, a network round trip to Supabase Auth, on every page and API request with a session cookie.
   - It then reads the maintenance flag (`middleware.ts:73`, `lib/maintenance.ts:6-16`): a Supabase REST fetch every 30 s per instance.
   - The route calls `getMe()` (`lib/auth/server.ts:63-66,82-89`), which repeats `getUser()` and then queries `subscriptions`.
   - `withTier` then awaits `botCheck()` and the Upstash `rateLimit` one after another (`lib/data/respond.ts:57-58`). `pageStore()` does the same for `/m/*` (`respond.ts:80-83`).

   *Fix:* in middleware, verify the JWT locally (`supabase.auth.getClaims()` with the project's JWKS) instead of `getUser()`. Pass the user id to routes in a request header. Cache tier per user for 60 s in memory, invalidated by the Stripe webhook. Run `botCheck`, `rateLimit` and `getStoreFor` with `Promise.all`.

Also worth doing, smaller:
- Look at what `chunk 7384` is (`ANALYZE=1 next build` with `@next/bundle-analyzer`). At 40 KB unused it is probably the TanStack Table/Virtual or Recharts code pulled into the home route.
- Precompute pays/chance facet counts per tier at load time (`lib/filters/apply.ts:182-245` re-counts on every request).

---

## P5 mid-multiplier check

### Backtest (`output/backtest.json`, ran_at 1794895098, chosen half-life 90 days, `results["90"].by_pays`)

| Band | Tier best: n | Tier edge: n | Edge events | Win rate | Avg price | ROI | t |
|---|---|---|---|---|---|---|---|
| 2–3x | **0** | 267 | 166 | 36.0% | 36¢ | **−2.5%** | −0.29 |
| 3–5x | **0** | 1,186 | 598 | 28.9% | 27¢ | **+2.9%** | 0.48 |
| 5–10x | **0** | 605 | 353 | 16.4% | 15¢ | **−0.8%** | −0.07 |
| (compare) 1.5–2x | 3,331 | 7,529 | 3,088 | 75.3% | 62¢ | +16.5% | 12.6 |

At the chosen half-life, **no tier-best bet in testing paid 2x or more**. The edge tier's mid bands are flat, with every |t| < 0.5, so it is neither proven to lose nor to win. The model is also over-confident there (predicted win rate 39.7% / 31.3% / 19.4% against actual 36.0% / 28.9% / 16.4%). Other half-lives agree: at hl=180, edge 3–5x is +8.2% (t 1.37) and 5–10x +6.3% (t 0.55). The no-decay run (`"None"`) is the only one that admits tier-best mid bets (2–3x n=15, 3–5x n=276, −8.3%). 10x+ loses clearly in every run (hl 90: −41.9%, t −1.70).

Honest copy for the Pays filter, backed by this data: *"2x–10x: in testing these roughly broke even (about −3% to +3%, not enough bets to tell). 10x+ lost money."*

### Live scan (`output/flags.json`, 2,778 flags: 1,070 best, 1,708 edge), by the pays band of `best.ask` (the side the engine and the app both use: `scan.py:113`, `pickSide(m, "best")`)

| Band | best | edge |
|---|---|---|
| <1.5x | 943 | 1,323 |
| 1.5–2x | 126 | 381 |
| 2–3x | **0** | **0** |
| 3–5x | **0** | **0** |
| 5–10x | **0** | **0** |
| 10x+ | 1 | 4 |

**None of the 2,778 live flags pays 2–10x.** (The prod "Big payouts" row shown on Nov 19 is a different, 3-day-old scan, and its cards are 10x+.)

### Does the tier-2 rule admit mid-multiplier bets?
- The rule is `engine/scan.py:48-54` `is_edge()`, mirrored in the backtest at `engine/backtest.py:90-96` `edge_mask()`. It requires: `edge_tier.price_min` (0.03, `config/demo.json:20`) ≤ mid < `price_max` (0.95), |mid − 0.5| ≥ 0.005, `edge` ≥ `flag_min_edge` (0.02), and `model_neff` ≥ `edge_tier.min_neff` (40). It has no `edge_low` or validated requirement.
- **On paper, yes: the price floor of 0.03 admits up to about 33x and the rule has no pays cap.** In practice few qualify:
  - `scan.py:113` picks `best` as the side with the highest `edge`, and on 2-sided markets that is usually the favourite. A 3x underdog side is only considered when it beats the other side.
  - The live tier-edge rule also requires a live order book (`scan.py:147`, `book_ok`).
  - Tier best uses `cfg.price_min` = **0.05** (`config/demo.json:18`), not 0.03. It also needs `edge_low > 0` and `validated` (`scan.py:135-138`). At low prices the confidence interval is wide, so `edge_low > 0` almost never holds, which is why best has n=0 in 2–10x.
- The point of P5 (backfill `--days 730 --per-tag 4000`, then refit) is to raise `model_neff` and narrow `win_prob_low`. That is the lever that would let more 2–10x sides pass `edge_low > 0`. No engine change was made here.

### Pays dropdown counts vs. the list (apps/web)
The counts are computed in `apps/web/lib/filters/apply.ts:239-244` (facet `pays`), and the dropdown renders them in `components/search/FilterPills.tsx:176-178`. Four ways the count can differ from what the list then shows:
1. **The count is rows; the list is event groups.** `group_by_event` defaults to true (`lib/filters/state.ts:45`), so the list shows groups cut to 4 rows each, and "Show more (N left)" counts groups (`BestBets.tsx:221`). The dropdown number is per market row. "3–5x (12)" can show as 5 cards.
2. **Free tier: rows are capped, counts are not.** `gateMarkets()` (`lib/data/gate.ts:78-88`) slices rows to `rowCap` (25) and sets `pages: 1`, but returns `facets` and `total` untouched. The dropdown can promise more than a Free user can ever see.
3. **The 2–3x band keeps the 40% chance floor.** `liftsFloor()` (`apply.ts:103-104`) lifts the floor only for `pays_min ≥ 2.5`. Picking 2–3x sets `pays_min = 2`, so sides with a win chance under 40% stay hidden, and that is most of the band (36¢ average price). The count is consistent with this (`apply.ts:243` applies the CHANCE mask for bands below 2.5), but the band is starved by design. Lifting the floor for any `pays_min ≥ 2`, or setting the 2–3x lower bound at 2.5x, would fix it.
4. **Tier widening.** Picking any Pays band widens Best bets to both tiers (`tierOf`, `state.ts:57-58`). The count does the same by ignoring the TIER bit when `f.tier === "best"` (`apply.ts:239`), so counts and list agree here. Users don't know the result now includes "Lower confidence" bets, though, so the dropdown should say "includes lower-confidence bets".

*Suggested test:* a Vitest case that runs `apply()` with each `PAYS_BANDS` entry selected, then checks `facets.pays[band] === total` with `group_by_event: false`, and `≥ total_groups` with grouping. Add a second case for Free through `gateMarkets`.

---

## P9 first-time user friction

I browsed https://kismetodds.com signed out in the built-in browser at 375×812 (phone) and at desktop width on Nov 19, ~13:15 EST. Ordered by impact.

| # | Friction | Fix | Where |
|---|---|---|---|
| 1 | **The data is 3 days old.** The header shows "Updated 3 days ago · data may be stale" in red, the headline says "Scanned 3 days ago", and a yellow banner repeats it: the same warning 3 times on the first screen. | Get the engine host running (spec P9). Until then, show one notice (the banner) and drop the repeat in the subhead. | `components/header/FreshnessPill.tsx`, `components/screener/BestBets.tsx` (subhead + banner) |
| 2 | **"Big payouts" cards contradict themselves.** One card says "Estimated return over +50%" and "$100 → over +$50", and two lines later "Bets like this … lost money in testing (−42%)". | When the band's backtest ROI is negative, show that number as the headline return, or hide the row. Spec P5 says to say it plainly. | `BetCard.tsx:80-90`, `TierNote.tsx:42`, `BestBets.tsx:160-163` |
| 3 | **Every card reads "+20–50% estimated"**, so signed-out ranges don't tell one bet from another. | For Free, show one rounded number from the backtest bucket (the "similar past bets returned" value) instead of a wide band, or rank-label them ("top 10%"). | `lib/data/gate.ts` (rangeSide), `lib/format.ts` `cardReturn` |
| 4 | **"$100 → +$20–$50" and "Likely to hit"** read like promised profit (already called out in spec P4). | "Bet $10 → get $13 if it wins"; "Strong record" / "Thin record". | `BetCard.tsx:90-92`, `components/market/labels.ts` (`chanceTone`) |
| 5 | **There is no "Sign up", only "Sign in"**, on both phone and desktop. | Add a primary "Sign up free" button plus a "Log in" text link (spec P2). | `components/auth/AccountLink.tsx`, `components/shell/Header.tsx:49` |
| 6 | **The Free limit is described two different ways.** Pricing says Free gets "3 best bets a day", which is the exact-number reveal quota (`reveals_left`, `lib/api.ts:65`; the drawer says "Free shows exact numbers on 3 bets a day"). Signed out, the home page lists "620 bets" with 25 ranged cards (`rowCap`). Neither place says "25 cards with ranges, 3 exact reveals a day". Spec P3 changes the limits again. | Say the same limit, in the same words, on pricing, the list header and the drawer. Show locked cards after the cap. | `components/pricing/Plans.tsx`, `lib/entitlements.ts`, `lib/data/gate.ts` |
| 7 | **The Pro and Premium buttons say "Coming soon"** (disabled) on /pricing, so there is no way to pay. `Plans.tsx:80` shows this whenever `/api/me` returns `billing: false`, i.e. `billingMode()` is null (Stripe env not set on prod), or before `/api/me` has loaded. | Check the Stripe env vars on the Vercel `kismet` project. While `me` is still loading, show "Start 7-day trial" pointing to `/login?next=/pricing` instead of the disabled button. | `components/pricing/Plans.tsx` |
| 8 | **The drawer is slow and the price differs from the card.** A click took more than 3 s to open the drawer, which then showed "Bet No at 83¢ live" while the card said 75¢ ("Pays 1.3x" is stale too). | Server-render the first page and prefetch the drawer data on hover (P6 fixes 2 and 3). On the card, show the live price with the scan price struck through. | `components/market/DrawerHost.tsx`, `BetCard.tsx:68` |
| 9 | **/markets on a phone** shows "Loading markets…" with skeletons for more than 3 s, under three rows of side-scrolling chips (filters, 9 "Views", 9 quick chips) before any data. | Server-render rows. On mobile, collapse Views and quick chips into the "More filters" sheet. | `components/screener/MarketsScreener.tsx`, `components/presets/PresetBar.tsx`, `components/presets/QuickChips.tsx` |
| 10 | **Jargon on the first screen:** "523 fair fill · 97 spread eats most of it", "+10–20 pts", "t-stat 34.7" on Results. | Hide the fill chips behind "Price check" in More filters. Say "10–20¢ cheaper than usual". On Results, lead with "won X of Y" and move the t-stat into a hover. | `BestBets.tsx:42`, `lib/format.ts` `sidePts`, `app/track-record` |
| 11 | **Signed-out nav shows "My list" and "My bets"**, which both lead to login. | Hide them until signed in, or show them with a lock and a one-line "Sign up to save bets". | `components/shell/nav.ts:2-8`, `components/shell/MobileNav.tsx` |
| 12 | **The phone search box is truncated to "Sear…"** next to the freshness pill, bell and Sign in. | On mobile, make search an icon that opens a full-width sheet, or give it its own row. | `components/shell/Header.tsx:44-50` |
| 13 | **No landing page.** A first visit drops straight into a dense screener with no "what is this" (the "How it works" link is hidden below `lg`). | Spec P1: signed-out `/` = landing page. Until then, a one-line explainer + "How it works" link that is visible on mobile. | `app/page.tsx`, `Header.tsx:46` (`hidden lg:block`) |
| 14 | **Results has no payout-band breakdown**, so "is a 5x bet any good?" can't be answered. The live record says "704 logged, none settled yet". | Add the `by_pays` table (P5). Show the live record only once some bets have settled, or show "first results on <date>". | `app/track-record`, `components/results/Tiles.tsx` |
| 15 | **Questions are written in raw machine form:** "Will 1. FC Köln win on 2026-11-20?" and "Exact Score: Any Other Score?" have no game context, and a "Bet No at 10¢" on "Will FC Bayern win" pays 10x. | Format ISO dates in questions ("on Fri Nov 20"). Prefix prop markets with the event title (it is in `m.event`). | `BetCard.tsx:56`, `lib/format.ts` |

Also noted: the onboarding nudge "Choose your topics" is the first element on the page for a signed-out visitor, before they know what the product is. It is better shown after sign-up (`components/onboarding/OnboardingNudge.tsx`).
