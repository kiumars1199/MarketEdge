# Kismet — status

Branch `final` (from `demo`), built overnight by one agent per lane, merged by the lead. `SETUP.md` covers accounts and
deploy; `LAUNCH_TODO.md` covers owner-only steps; `AUDIT.md` holds the final audit.

## How to run
See `SETUP.md` §0. Short version: `python3 -m engine scan`, then `cd apps/web && pnpm i --frozen-lockfile && pnpm dev`.
Checks: `python3 -m pytest -q engine/tests ops/tests`, then in `apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
Extension: `pnpm ext:zip` (see `docs/setup-notes/trading-extension.md`).

## What works
- **Engine (Lane A):** 2-year history (1,484,104 resolved markets, 1,738,882 bets), 52 weekly walk-forward folds,
  90-day half-life. Best bets +13.9% ROI, t = 34.7. Two tiers on every flag (`best`, `edge`), `by_pays` breakdown,
  combo backtest (2-leg +16.9%, 3-leg +25.7%). `engine update` paginates by date window (T-85), no Gamma offset error.
- **App (Lanes S, C, U):** Best bets home at `/`, landing at `/about`, smart search with suggestions, five pills,
  Pays pill on both tiers, "Biggest payout" sort, 2x+/5x+/10x+ chips, "More bets with an edge", `formatCount`,
  combo tray and suggested combos (hidden when the combo backtest loses), docs/17 polish, live price pulse,
  New badge, closing-soon strip, results ticker, Today card. Lighthouse mobile performance medians 92 / 93 / 94 on `/`, `/about`, `/pricing` (audit run 5); accessibility and best practices 100, SEO 91;
  axe 0 serious/critical. Screenshots of every page at 390 and 1440 px in `docs/screenshots/final/`.
- **Accounts and billing (Lane L):** Supabase Auth (Google + magic link), 18+/Terms checkbox, onboarding saved to the
  account and honoring a safe `next`, `/account` export/delete/sign-out-everywhere, local→account import, 3-session
  limit, Stripe Checkout and Payment Links, verified idempotent webhook, portal, 7-day trial, server entitlements,
  "Coming soon" when keys are empty, legal pages from `config/site.json`, SEO, 404/500.
- **Trading (Lane K, paper only):** keys only in the extension (non-extractable WebCrypto, transfer/full-write keys rejected),
  one-time server nonces, order ticket with confirm every time, caps, `client_order_id`, demo exchange only.
- **Extension (Lane E):** popup, side panel, sign-in handoff, Premium gate, key vault, disclaimer, `docs/STORE_LISTING.md`.
- **Ops (Lane O):** engine Dockerfile + Railway/Fly config, private Supabase bucket, data fallback chain, refresh.yml,
  web CI, `/api/health`, Sentry with PII scrubbing, PostHog cookieless, Resend with one-click unsubscribe, Vercel crons.
- **Admin (`/admin`):** user count, plans, signups, app settings (maintenance mode, banners), audit log, CSV export. Allowed only for `ADMIN_EMAILS`; everyone else gets 404 on every method.
- **Owner scripts (`ops/`):** preflight, secrets, Stripe setup, Vercel env push, site config, Supabase setup, prod smoke test; runbook in `ops/ship.md`.
- **Security (Lane X):** server paywall and row trimming, Upstash rate limits, BotID/Firewall rules, AI-crawler blocks,
  RLS with cross-user tests, CSP nonce + headers, CSRF, zod on every input, webhook signatures, pinned dependencies.

## Behind a flag
- `DEMO_MODE=true`: no login, everything unlocked (default outside production; production needs exactly `true`).
- `KALSHI_TRADING_ENV=demo` (+ `TRADING_ALLOWLIST`): paper trading on Kalshi's demo exchange. Empty = off. No prod path.
- `KALSHI_DATA_PERMISSION=true`: Kalshi combo price check. Off until Kalshi grants permission in writing.
- `E2E_MOCK=1`: in-app Supabase/Stripe mock for paid e2e; refused in production.

## Needs an owner value
`config/site.json` is filled (Kismet, kismetodds.com, kismetodds@gmail.com, Kiumars Momtaz and Marc Yamin, Indiana,
United States, 18+, no mailing address, refund of the first charge within 7 days). Payment Link URLs and every key in
`SETUP.md` §2 are still the owner's. Lawyer review of legal pages (`LAUNCH_TODO.md`). Deploy steps: `ops/ship.md`.

## Final audit
Final pass (Nov 18-19, T-252-T-262): rename to Kismet (0 hits for the old name outside git history), brand and tagline,
owner values in `config/site.json` and the legal pages, cleanup (`CLEANUP.md`), deploy prep (`ops/ship.md`, Vercel
team `kismet9`, project `kismet`), CI fix (extension deps). Audit run 10 (full, `AUDIT.md`) found 2 fails: a late
checkout event could drop a paying user to Free (T-260) and the extension zip step in `ops/ship.md` (T-261). Audit run 11
(those items, everything changed since, full unit and e2e suites, CI on PR #2): zero fails, CI green. Billing is verified
against the in-app Stripe mock only; the "Owner verification" list in `AUDIT.md` covers the live checks. Earlier runs
1-9 are in `AUDIT.md`.

## Launch polish
T-220–T-231 (branch `polish`): a real-user pass at 390 and 1440 px fixed overflow, wrapping and tap targets on /m, the drawer, /, /about, /pricing, onboarding/Settings topics, alerts and the footer. Before/after shots in `docs/screenshots/polish/`. Lighthouse mobile on `/` after the pass: 97 / 97 / 97 (median 97).

## Known issues
- Vercel Hobby rejects the 5-minute alerts cron; needs Pro (in `LAUNCH_TODO.md`).
- Kalshi fee formula in the order ticket is unverified against a live Kalshi fill.
- Kalshi combo check never shows today: the engine emits no `kalshi_ticker`.
- `pnpm audit`: no high. picomatch ReDoS (GHSA-fc5q-39xc-vjpf) has no upstream release, so a patched copy lives in `vendor/picomatch` (pnpm overrides, web + extension) with a ReDoS regression test. One moderate remains in eslint-only dev tooling (minimatch).
- Vercel OWASP managed ruleset needs Enterprise; other firewall rules apply.
- Lighthouse SEO 91: Next 15 streams the meta description into `<body>` for normal browsers (`htmlLimitedBots: /.*/` fixes it but costs ~15 performance points).
- No 500 screenshot (no route can be forced to fail); `app/error.tsx` checked in code.
- Edge tier 2–3x, 5–10x and 10x+ lost money in the backtest; those bands are shown with their record, not promoted.
- Exact counts kept on purpose: trade-ticket contract quantity and the bell's `aria-label` unread number.
- Closing-soon strip and results ticker are empty on current data (nothing closes within 3 h; nothing settled yet).
- `volume_24h` is null for most markets (Gamma omits it); the 24h-volume filter matches only markets that report it.
- With "My list only" on, rows are filtered per fetched page, so a page can come back short.

## Decisions (overnight final build, Nov 17)
- Branch `final` from `demo`; lanes run in worktrees and the lead merges each with `--no-ff` after typecheck/lint/test.
- Shared data contract (`tier`, `by_pays`, `combos`) written by the lead first (T-79) so lanes A, S and C don't each invent it.
- Data check cap: tier-"best" flags ≤ 10% of scanned markets (was 5% over all flags). The 2-year history validates more categories (7.7% on Nov 17; 52-fold backtest +13.9% ROI, t = 34.7). Tier "edge" has its own rule checks and no cap.
- E2E demo flows run against a production build (`next build && next start`); on-demand compiles under `next dev` timed out at random under parallel load. `PW_DEV=1` switches back. Paid flows stay on dev because the Supabase/Stripe mock is off in production by design.
- "Run now" on /alerts shows in demo mode as well as dev (local test aid; demo is never deployed).
- ESLint `argsIgnorePattern: "^_"`.
- `/flags` permanently redirects to `/` (Best bets is home); every internal link updated.
- `engine update` hit Gamma "offset too large"; fixed test-first by splitting date windows (T-85, touches `pipeline/fetch_closed.py`).
- Onboarding finish waits for the account session and saves `onboarded_at` server-side; falls back to a full load if routing stalls.
- Lane U: `/` renders per request with the headline count in first paint; Recharts loads only with a drawer; Best bets shows one card per game by default (`g=0` shows all) and 12 cards before "Show more"; "unusually high" note only in the drawer; Today card shows only the user's own saved bets/alerts/P&L (not picks).
- Lane A's 2-year history (1.3 GB `data/`) is cloned into the main checkout; the older copy is kept as `data.pre-backfill/` (gitignored).

- picomatch: first accepted as build-time-only, then failed audit run 2; replaced by the vendored patched copy (T-190). The patch treats a few rare glob shapes as literal text; only build tooling uses them.
- Stripe webhook keeps answering 500 for a subscription whose customer has no linked user yet (Payment Link events can beat checkout.session.completed; Stripe's retry links it). Triggering it costs the sender a real payment, so the retry load is self-limiting.
- Red-team fixes: production without Upstash uses a per-instance in-memory limiter (never unlimited); Free/anon get 30 list calls/min and 1,500 distinct rows/hour; filters run on banded values; Payment Link refs are HMAC-signed (key derived from STRIPE_WEBHOOK_SECRET, 7 days since T-236); quotas and server-owned profile columns enforced by Postgres triggers.
- Red-team run 3 fixes (T-230 to T-237, branch `fix-rt3`):
  - RT3-01: the per-market curve goes only to tiers with exact edge, or with a counted Free reveal. Free and signed-out get `curve: null` in `/api/markets/<id>` and the `/m` props. The drawer shows no curve chart for them.
  - RT3-01: `/api/model/curve` is tier-aware and limited to 60 calls a minute. Pro+ get any segment, exact. Free and signed-out get only `all` and `cat:<category>`, rounded to 5 pp (the width of Free's band). Niche segments answer 403.
  - RT3-01: `/track-record` stays public. Free and signed-out see its curves rounded to 5 pp; paid tiers see them exact. `docs/02-architecture.md` is updated.
  - RT3-01, measured: over the full scan, the red team's suggested coarsening (1 pp, 10-point grid) still matched 76% of markets, so it was rejected. With no curve for niche segments and 5 pp curves for `all`/`cat`, the attack in `test/paywall.test.ts` matches at the "band + public mid" baseline: 93% before the fix, about 27% after. On `all`/`cat` markets alone, 5 pp gives 20% against a 28% baseline.
  - RT3-02: `/m/<id>` and `/event/<id>` apply the API's `markets` rule to every tier, keyed by user id or platform IP. Free and signed-out also count each market shown against the 1,500 distinct-rows-an-hour budget shared with the list routes.
  - RT3-02: a refused page load shows a "Slow down a little" state with HTTP 200 and `robots: noindex`. A Server Component can't set 429, and `lib/abuse.ts` is Node-only, so middleware can't run it. No exemption by user agent.
  - RT3-02: BotID is not added to the pages. `checkBotId()` on a first HTML load would flag real visitors, because the client challenge hasn't run yet.
  - RT3-02: `load()` is wrapped in React `cache()`, so metadata and page count once per request.
  - RT3-03: the brief's rule, "rotate the replaced scan into prev only when it is at least 15 min old", was not used. At the 10-minute cadence the replaced scan is always about 10 min old, so prev would never move and Free would freeze on one scan.
  - RT3-03: instead, every publisher keeps two older scans: engine `scan_keeping_prev`, `ops/upload.py` and `refresh.yml` all shift prev to prev2, then live to prev. `getStoreFor` serves Free the newest of {newest scan, prev, prev2} that is at least the delay old, or the pending state if none is.
  - RT3-03: the store reads prev2 only when prev is too young. Published copies are kept in memory, so they become eligible as they age. Steady state, Free sees data 15 to 25 min old.
  - RT3-03 ceiling (`ponytail:` in store.ts): a burst of back-to-back scans can show Free a few minutes of the pending state.
  - RT3-03: `delay_min` stays the plan minimum (15), and `meta.scanned_at` gives the real age. The copy in `lib/` and `/status` now says "at least 15 minutes". The "15 minutes behind" strings in `components/pricing/Plans.tsx` and `app/pricing/page.tsx` are left for the polish branch; they are now a true minimum.
  - RT3-07: `/status` uses `getStoreFor(tier)`, so Free and signed-out see their copy's time and counts. If Free has no copy old enough, it shows the pending state.
  - RT3-04: the formula guard is in the shared `cell()` and applies to text cells only, so numbers like -0.05 stay numbers. Text cells starting with "+", such as "+12%", now export as "'+12%". Negative formatted values use U+2212, so they are not prefixed.
  - RT3-04: the admin export's private `safe()` is deleted; it uses `cell()`. The journal export uses `cell()` too, and the journal import strips the leading `'`.
  - RT3-05: every admin action first writes an intent audit row. If that write fails, nothing changes and the route answers 500.
  - RT3-05: after the change, a `<action>.done` row is written on a best-effort basis. If it fails, the error is logged and the response still succeeds, because the intent row already records the action.
  - RT3-05: the settings "before" value is read straight from `app_settings`, not the 60 s cache. A failed read aborts the action.
  - RT3-06: MFA is not built. `ADMIN_REQUIRE_MFA` is empty by default. When it is `true`, `requireAdmin()` and the middleware admin check need an aal2 session, read from the JWT with no network call.
  - RT3-06: the app has no TOTP enroll screen, so the flag stays off until that screen exists. See `docs/setup-notes/admin.md` and `LAUNCH_TODO.md` step 11.
  - RT3-08: `stripe-setup.mjs` always masks the webhook secret and points to the Stripe dashboard. It runs `chmod 600` after writing an env file.
  - RT3-09: the signed `client_reference_id` lasts 7 days instead of 24 h. A later payment is still ignored: the owner refunds it or comps the user. There is no customer-email matching and no alert.

## Decisions (lead calls, incl. blockers > 20 min)
- Design tokens: the approved artboard wins over the old docs/06 values; docs/06 now lists what the app implements.
- docs/08 said demo runs as `pro`; docs/01 and the brief say `premium`. Went with premium, fixed docs/08.
- Engine warning text says "15c" (scan.py) where docs/07 says "15¢"; UI shows its own plain-language label ("Unusually high — similar past bets returned +X%", or "check details" when unknown), so the raw string is not user-facing.
- LocalRepo adds sync `snapshot()`/`profileSnapshot()` for useSyncExternalStore; SupabaseRepo must serve them from a cache.
- Lane A widened SAMPLE_TAGS and added tag aliases (cbb→ncaab, mma→ufc, formula1→f1) so new niches get history; kept.
- Grouped screener pages over event groups (≤50 per page, best row + up to 3 more each, `size` = full count); docs/04's "paginate groups" sent 2.8 MB pages on real data.
- Worktrees spawned by the agent tool start from `main`, not `demo`; every lane brief begins with `git reset --hard demo`.
- Lanes C and D split in two each (C1 screener+drawer, C2 results/landing/status, D1 presets/list/onboarding/keys/CSV, D2 settings/dashboards/bets/Kelly/tools/alerts) so five teammates work on disjoint files.
- Playwright e2e runs on port 3100 against fixtures (never reuses a real-data server on 3000).
- T-60: fixtures in `apps/web/test/fixtures/` already existed (500 markets, 150 flags); reused as-is.
- `engine fit` needs `data/` (gitignored, ~1 h Polymarket bootstrap). Bootstrap started locally at the start of the night.
- Lead review fixes after the advisor pass: stake table says "You get back if it wins" (it is payout, not profit); "pick"/"edge" removed from casual text (Pro mode and Results keep "edge"); landing hides the ¢-per-share and t-stat tiles (kept on Results); save star is 44px; landing count, Best bets page and the built-in "Best bets right now" view all use worth it + thin.
- Alert channel type gained `"inapp"` (D1's target-price alerts); D2's inbox is always on regardless.
- Engine `scan` keeps the replaced scan as `*-prev.json`; with no older copy, Free pages show "New prices are on the way" (503 `delayed_pending`), never live data early.
- Site-wide client hosts load after hydration; Sentry and PostHog start when the browser is idle (Lighthouse).
