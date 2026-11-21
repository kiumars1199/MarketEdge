# Handoff: polish round (docs/19), Nov 19, 2026

The owner's machine shuts down at 3:30 PM EST. This file says what is done, what is in progress and what is next,
so a cloud session can continue. Work on `final`; every push to `final` deploys kismetodds.com (Vercel project
`kismet`), so only push green work (web: lint, typecheck, unit, build; Python: pytest).

## Done (on `final`)
- **T-266**: `.github/workflows/refresh.yml` scans every 30 min and uploads `output/*.json` to the Supabase bucket
  `scan` (`ops/upload.py`); a full update + refit runs every 2 h (`17 */2`) and on manual runs. Every refresh run had
  been failing on Gamma's `422 offset too large`; `pipeline/fetch_closed.py` now splits the window instead (test:
  `engine/tests/test_closed_events_offset.py`). A manual full run after the fix (actions run 44583477740) still
  failed; its log wasn't read because the GitHub API rate limit ran out. **First thing to check.**
- **P1** landing page for signed-out visitors at `/` (`components/landing/`); Best bets also at `/bets` (the nav tab
  now points there). Signed-in and `DEMO_MODE` visitors still get Best bets at `/`. Research in
  `docs/research/polish-round.md`; screenshots `docs/screenshots/polish/landing-*.png`.
- **P2** Google button only when `NEXT_PUBLIC_GOOGLE_AUTH=1` (the API route refuses too); header "Sign up" + "Log in";
  `/signup` and `/login` share `components/auth/AuthPage.tsx`; skippable 5-step tour (`components/onboarding/Tour.tsx`),
  replay from `/account` (`/?tour=1`).
- **P3** Free = 10 Best bets a day, seeded by user id (or IP) + UTC date, trimmed on the server; blurred locked cards
  "Unlock all N bets" → /pricing; Free rows 25 → 10; combos moved to **Premium only** (owner decision: to give Pro
  combos again add `"combos"` to the pro list in `lib/entitlements.ts`).
- **P4** cards read "Bet $X → get $Y if it wins" (X = default stake); "Likely to hit" → "Strong record" / "Thin record".
- **P6 (part)** the scan store serves the cached copy while it reloads (stale-while-revalidate).
- **P8** admin plan grants by email (`/admin/grants`), pending grants applied at first sign-in, every change in
  `admin_audit_log`; migration `supabase/migrations/20261119000300_plan_grants.sql`.
- **Kalshi** (behind `KALSHI_DATA_PERMISSION`, default off): `pipeline/fetch_kalshi.py` → `output/kalshi.json`
  (polite: 100/page, 1 s gap, backoff, 10-min cache), `GET /api/kalshi`, `/kalshi` page with a "Kalshi" credit on every
  number and kalshi.com links. Kalshi's public API lists combo markets but none had a resting ask; combos show Kalshi's
  own ask when there is one, else the legs' Kalshi asks multiplied, labelled so.
- **Live re-pricing** (`lib/reprice.ts`): paid Best bets pages (`/api/flags`, Pro/Premium) read current CLOB prices
  in one batched `POST /prices` (15 s cache, 1.5 s timeout falls back to the scan price), recompute edge, fee, Pays,
  verdict and tier (best can only drop to edge), and drop bets below `MIN_EDGE`; cards show "Price as of Xs ago".
  Free is untouched (stays 15 min behind). Off with `LIVE_REPRICE=0`, `DATA_CLOCK=scan` (tests) and under Vitest.
  Tests: `test/reprice.test.ts`.
- **Scheduler** (`ops/scheduler.py`): cadence from `SCAN_EVERY_SEC` (default 120 s); the upload keeps `*-prev` copies
  at least 15 min minus one cadence apart, so Free stays 15 min behind.
- Paid e2e S7 keyboard flow now searches a bet from the Free user's daily sample (P3 hides the others on Best bets).
- Research notes for P2, P5, P6, P7, P9: `docs/research/polish-round-2.md` (read this before continuing).

- **T-277**: `ops/upload.py` stores bucket objects gzip-compressed under the same names (Content-Type
  `application/gzip`, no Content-Encoding); `lib/data/store.ts` `decodeBody` and `upload.py` `get_json` sniff the
  magic bytes `1f 8b`, so plain and gzip objects both read. Rollout order: see Owner actions (T-277/T-278 rollout).
- **T-278**: `pipeline/fetch_closed.py` caps lifted. `--per-tag` and `--per-window` above Gamma's offset limit (~2000)
  work (busy windows split, `iter_closed_events`), `0` = no cap, rows stream to disk page by page, `--pause` 0.1 s
  between pages. Backfill checkpoints record each (window, tag)'s cap (`caps` in `data/fetch_closed_state.json`;
  old entries count as 200), so a rerun with a bigger `--per-window` tops windows up instead of skipping them.
  `mode=backfill` in refresh.yml now uses `--per-window 1000` (was 200). Defaults unchanged: `--days 365`,
  `--per-tag 2000` (bootstrap, Railway), `--per-window 300`. A rerun after a kill trims a half-written last row.
  Only backfill mode is resumable; default mode restarts. Tests: `engine/tests/test_fetch_closed_caps.py`.
  Note: `mode=backfill` grows only the Actions cache copy of `data/`; the Railway engine (primary) has its own volume
  and only bootstraps (no args) when `sample.jsonl` is missing, so the bigger history reaches Railway only if the
  backfill is run there too (Owner actions).

## Next steps (in order)
1. Read the failed refresh run's log (`gh run view 44583477740 --log-failed`) and fix; then confirm a scheduled
   scan-only run (:00 / :30) passes.
2. ~~Re-pricing gaps~~ done: Best bets, All markets, the drawer and `/m/[id]` re-price for live tiers (Free and a Free
   reveal stay on the delayed scan); the win chance is recomputed at the live mid with the engine's own model formula
   (`predictAt`, parity-tested against `output/flags.json`); a bet whose mid leaves the engine's price range drops
   (best 5–95¢, edge 3–95¢, never within ½¢ of 50¢); Best bets page 1 is rendered on the server with the same body as
   `/api/flags` (`listBody`), so the headline count matches the cards. `total` still subtracts only page 1's drops.
3. P3 gaps: Free can still see flagged bets outside the day's 10 (banded) via `/api/markets`, `/api/events/[id]`,
   `/m/[id]` and `/api/suggest`; pass the daily seed into `eventBody`/`marketBody` and the suggest route.
4. P5 app side done: /track-record "By payout" table (both tiers per band, verdict calls a sign only at |t| >= 2, a big
   unproven loss still reads "lost money"); the Pays dropdown shows each 2x+ band's tested return and says picking a
   payout includes lower-confidence bets; any 2x+ band lifts the 40% chance floor (was 2.5x, which starved 2–3x);
   test: each band's dropdown count equals the list total. Still owner-run: dispatch refresh.yml `mode=backfill` (730
   days, resumable) then refit, and report the new counts.
5. P6 done (except static caching): Best bets page 1 + "Closing soon" and All markets page 1 render on the server
   (`firstPage`, parity-tested against /api/flags and /api/markets); Big payouts, Combos and More bets with an edge
   fetch when scrolled near (`useNear`), so a plain page load makes no protected list call. BotID's challenge script
   (c.js) only loads on the first protected fetch (`initBotId` itself just wraps fetch), so it no longer runs on plain
   loads; Pro still starts it ~1.5 s in for live card prices. BotID and the rate limit still run before the store load
   (a refused request costs nothing). Filter changes, the drawer and search on the same page update the URL with
   `history.pushState` (`lib/softNav.ts`), so they no longer re-render the page on the server: filter chip → cards
   ~215 ms, card → drawer ~845 ms locally. Lighthouse mobile, local prod build vs the P5 build: `/` 78 → 80–82, `/markets`
   41 → 74 (LCP 6.9 s → 1.2 s). `/markets` TBT is still ~1.4 s (hydrating ~200 mobile cards). Not done: CDN caching
   of static pages, because the per-request CSP nonce forces dynamic rendering; dropping the nonce would weaken the
   CSP. Check on prod after deploy: the first filter change on Best bets takes the BotID challenge (one-time).
6. P7 UI pass with Impeccable (12 patterns in the research notes), before/after shots at 390/1440 in
   `docs/screenshots/polish/`. P9: the 15 friction points in the research notes.
7. Full audit (`docs/OVERNIGHT.md` §3) by a fresh auditor, loop to zero fails; then `ops/smoke-prod.sh https://kismetodds.com`.

## Owner actions
- **T-277/T-278 rollout, in this order:** (1) confirm the `final` web deploy is live (its loader reads gzip and plain);
  (2) merge `final` into `main` (Railway and the refresh.yml cron both run `main`'s `upload.py`; an old `upload.py`
  can't read a gzipped `flags.json`, so never run the new uploader, e.g. a refresh.yml dispatch from `final`, while
  Railway still runs the old one); (3) watch one Railway scan log `uploaded flags.json` and the site's scan time
  advance (first real test of gzip against Storage); (4) dispatch refresh.yml `mode=backfill` **from `main`**, rerun
  until the log says `backfill done`, check `history: N markets`. (5) Optional, for Railway's own model: stop the
  scheduler (single writer), then in the container `python pipeline/fetch_closed.py --days 730 --window-days 30
  --per-window 1000 && python pipeline/fetch_prices.py --extend --threads 8 && rm -f data/markets.jsonl`, then
  restart. Watch the 5 GB volume and 1 GB RAM (the backfill holds every stored market id in memory).
- Add GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (LAUNCH_TODO item 12).
- Vercel: `ADMIN_EMAILS` including `kismetodds@gmail.com`; check the Stripe env vars (live `/pricing` says "Coming soon"
  because `/api/me` reports `billing: false`).
- Apply migration `20261119000300_plan_grants.sql` in Supabase (`/admin/grants` errors until then).
- Apply migration `20261119000500_first_bets_visit.sql` in Supabase (T-276: `profiles.first_bets_at` + the
  `admin_activation()` counts). Until then Best bets skips the write and /admin shows a note instead of Activation.
- `NEXT_PUBLIC_GOOGLE_AUTH=1` only after Google OAuth is set up in Supabase.
- Kalshi: written data permission before `KALSHI_DATA_PERMISSION=true` (Vercel and the scan step env in refresh.yml);
  check that `https://kalshi.com/markets/<series>` links resolve.

## Environment notes
- On the owner's Mac `git fetch` fails with `bad object refs/remotes/origin/final 2` (an iCloud duplicate ref). Use
  `GIT_REF_PARANOIA=0 git fetch`. A cloud clone doesn't have this ref.
- The GitHub repo is now `kiumars1199/Kismet` (old name redirects).

## Beta access (T-274)
- `getMe().beta`: admins (ADMIN_EMAILS, verified email) and accounts with a live comp grant (comp_tier set, not
  expired). Admins are also Premium. Demo mode counts everyone as a tester (no customers there).
- `lib/beta-list.ts` `BETA_FEATURES` = combos, kalshi. `canBeta(me, f)` in `lib/beta.ts`: beta → testers only, any
  plan; customers (even Premium) get 404 pages, empty/404 APIs and no nav link. Once a feature is removed from the
  list its live rule applies again (combos: Premium; Kalshi: `KALSHI_DATA_PERMISSION=true`).
- Testers see /kalshi even with `KALSHI_DATA_PERMISSION` off. /api/kalshi is `private, no-store` while in beta.
- Every beta surface uses `components/beta/BetaBadge.tsx` (pill in nav, banner on the page, tag on the Best bets
  Combos row, "Add to combo" and the combo tray).

## Email + password (T-275)
- `/login` and `/signup`: Google first (when enabled), then tabs "Password" (default) and "Email link". `/signup`
  creates the account and says "check your email to confirm"; "Forgot password?" emails a reset link that lands on
  `/reset-password` (noindex). Routes: `app/api/auth/password` (signup/signin), `app/api/auth/reset`,
  `app/api/auth/password/update`. Details and limits in docs/08 § Auth.
- **Owner: Supabase Auth → Providers → Email → "Confirm email" must be ON.** With it off, sign-up returns a session
  and the route deletes that user and answers 503 ("use the email link"), so password sign-up stays unavailable.
- **Owner: session length** is the Supabase dashboard setting (Auth → Sessions: time-box / inactivity timeout,
  refresh-token reuse). The `sb-*` cookies themselves last 400 days (`@supabase/ssr`); don't add `maxAge` to
  `COOKIE_OPTIONS` (it would override sign-out's `maxAge: 0`).
- Owner (optional): Supabase "leaked password protection" on; Site URL / redirect allow-list must include
  `/auth/callback` (already used by the email link). A confirmation link opened in another browser confirms the
  address but can't sign that browser in (PKCE); the /login error says to log in with the password.

## Account required (T-276)
- Signed out, only the public list in `apps/web/lib/auth/public-paths.ts` answers (one place; extend it there):
  `/`, `/pricing`, `/about`, `/track-record`, `/status`, the legal pages, `/login`, `/signup`, `/reset-password`,
  `/auth/*`, `/m/*` and `/event/*` (teasers), `/maintenance`, robots/sitemap/llms.txt/`.well-known`/icons/share images. Every other
  page redirects to `/signup?next=<page+query>` (`/oauth/*` to `/login?next=`); every other API route is a 401
  JSON `{ error, signin }`. Public APIs: health, meta, me, backtest (same figures as /track-record), `/api/auth/*`, stripe webhook, unsubscribe, the two cron
  routes, the extension's token refresh/telemetry/trade config/nonce verify, `/api/events/by-slug` (the route itself
  needs a session or an extension bearer token) and `/api/mcp` (OAuth bearer, checked by the route). `/admin` and
  `/e2e-mock` keep answering 404 to non-admins. Demo mode and builds without Supabase keys have no wall.
- Signed-out `/` is the landing (`components/landing/Landing.tsx`): hero, 3 real Free-gated best bets + 6 blurred
  placeholder shapes (no data), proof from backtest.json (+ the live ledger once bets are graded), plans, FAQ,
  disclaimer. Signed out, `/` with any query is the landing; only `/?m=<id>` (a market deep link) goes to sign-up.
  The 3 real cards are the Free daily sample (key "landing"), the CTA says "Sign up free to see 10 of all N bets".
- `/m/<id>` and `/event/<id>` signed out: title, category, closing time and "Kismet has a verdict on this market.
  Sign up free to see it" (`lib/teaser.ts`, `components/market/Teaser.tsx`); the share image is the teaser too.
- Header signed out: How it works, Results, Pricing, Log in, Sign up (no search, alerts or app tabs). Until
  `/api/me` answers, the header briefly shows the app tabs (client-side, as before).
- e2e only: the Stripe mock rewrite `/v1/*` (next.config, dev + E2E_MOCK) passes the wall.
- Admin → Activation: sign-ups and first Best bets visits per day and over 7 days (`admin_activation()`); the visit is
  stamped once per account after a signed-in Best bets render (`lib/activation.ts`, service role, best effort).
- Not changed, for the owner to know: `ops/redteam/*` scripts call `/api/markets` and `/api/flags` without a cookie;
  they now get 401 (expected). `ops/smoke-prod.sh` only uses public routes and still passes.

