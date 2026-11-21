# Red-team run 2 (2026-11-17)

Scope: `origin/final` checked out as `redteam2`, attacked on localhost only (ports 3900–3999). This run
treats every claim in run 1's `REDTEAM.md` and in `STATUS.md` as unverified and tries to bypass each fix,
and attacks the new admin dashboard (`/admin`, `/api/admin/**`, `app_settings`, `admin_audit_log`,
comp tiers, maintenance mode).

Targets and method
- **Target B (primary), dev + in-app mock:** `next dev -p 3900` with the env from `playwright.paid.config.ts`
  (`DEMO_MODE=false`, `E2E_MOCK=1`, mock Supabase + Stripe, `ADMIN_EMAILS=admin-e2e@example.com`), plus
  `KALSHI_TRADING_ENV=demo`, `EXT_SIGNING_SECRET`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, real `output/` data.
  Sessions built with `ops/redteam/login.sh`: `free@x.test` (Free), `pro@x.test` (Pro, trialing),
  `premium@x.test` (Premium), `admin-e2e@example.com` (Admin).
- **Database layer:** `ops/redteam/rt2-db.test.ts` loads **every** `supabase/migrations/*.sql` into PGlite (so the
  T-140 admin tables and the RT fix triggers are live) and attacks them as a plain `authenticated` JWT, the way a
  user would hit PostgREST directly. `ops/redteam/ext-cap-race.test.ts` runs the real extension `background.ts`
  with a stubbed `chrome.*`.
- **Target A (production build):** the production-only controls (RT-02 falls back to the in-memory limiter rather
  than off; the e2e mock and `DEMO_MODE` are gated on `NODE_ENV !== "production"`; admin fails closed to `notFound()`
  when Supabase keys are empty) were confirmed by reading the code paths, building on run 1's confirmation that a
  production build with empty keys fails closed. No external service (Polymarket, Kalshi, Stripe, Resend) was
  contacted.

## Findings

| ID | Severity | Title |
|---|---|---|
| RT2-01 | Low | `GET /api/admin/export` has no same-origin check (the admin mutation route does) |

### RT2-01 · Low · Admin CSV export lacks the same-origin check its sibling mutation route enforces

- **Where:** `apps/web/app/api/admin/export/route.ts:16-19`. The export `GET` calls `requireAdmin()` and the rate
  limit, but not `sameOrigin(req)`. `POST /api/admin` (`apps/web/app/api/admin/route.ts:37`) does check it.
- **Repro (admin session cookie, forged `Origin`):**
  ```
  POST /api/admin   Origin: https://evil.test  -> 403 Bad origin
  GET  /api/admin/export  Origin: https://evil.test  -> 200  text/csv; charset=utf-8
       CSV first line: id,email,created_at,last_sign_in_at,tier,status,comp_tier,comp_expires_at
       rows: 4
  ```
- **Observed:** the export returns the full user list (id, email, tier, status, comp tier — PII) regardless of the
  request `Origin`, and writes a `users.export` row to `admin_audit_log` on every call.
- **Impact:** limited. The session cookie is `SameSite=Lax`, so a silent cross-site `fetch`/`<img>` does not carry
  it, and CORS stops any cross-origin reader from seeing the body; the realistic vector is tricking a signed-in
  admin into a **top-level navigation** to the URL (a link), which downloads the CSV to the admin's own disk and
  writes an audit entry and a full-table scan server-side. No cross-origin exfiltration. Adding `sameOrigin(req)`
  (and ideally making export a `POST`) makes it consistent with every other admin mutation.

## Attempted and held

Admin dashboard — access control (Target B, live requests)
- `GET /admin` as anon, Free, Pro, Premium → **404**; as Admin → **200**. Same for `/admin/users`,
  `/admin/settings`, `/admin/audit`, `/admin/health` (404 for Free). The guard returns `notFound()`, never 403, so
  the panel's existence is not revealed (`lib/admin/server.ts:22`).
- `POST /api/admin` (settings/comp/…) as anon, Free, Pro, Premium → **404**; as Admin → **200**.
  `GET /api/admin/export` as anon, Free, Pro, Premium → **404**; as Admin → **200**.
- **CSRF on the mutation route:** `POST /api/admin` with no `Origin` → **403**; with `Origin: https://evil.test` →
  **403**. Only `sameOrigin` requests pass.
- **Comp-tier abuse:** Admin comps `free@x.test` to premium → `/api/me` reports `premium`; uncomp → back to `free`.
  A Free user calling the same `comp` action on itself → **404** (not an admin). `effectiveTier` honors
  `comp_expires_at`; the `comp` action's zod `refine` rejects a past `expires_at`.
- **Email case / verification / demo / metadata spoofing:** the guard matches the verified `email` claim from
  `supabase.auth.getUser()`, trimmed and lower-cased on both sides (`lib/admin/core.ts`); it ignores
  `user_metadata.email`, requires `email_confirmed_at`, and returns null in `DEMO_MODE`. `/api/me` reports
  `admin:false` for every non-admin session.

Admin dashboard — data layer (`ops/redteam/rt2-db.test.ts`, all migrations in PGlite, as `authenticated`)
- `insert`/upsert into `app_settings` with a user JWT → `new row violates row-level security policy`; `select` → 0
  rows. Same for `admin_audit_log`. Both tables have RLS on with no policies and `revoke all from anon, authenticated`.
- `admin_audit_log` is append-only **even for the service role**: `update`/`delete`/`truncate` →
  `admin_audit_log is append-only` (trigger), while an `insert` succeeds.
- **XSS via the banner:** setting `banner_text` to `<img src=x onerror=alert(1)>` and loading `/` renders it as
  text (`&lt;img src=x onerror=alert(1)&gt;`); the banner is `{banner}` in JSX (`app/layout.tsx:44`), React-escaped,
  and the value is zod `.max(280)`.
- **CSV injection in the export:** `safe()` prefixes a leading `= + - @ \t \r` with `'`
  (`app/api/admin/export/route.ts`), and the only attacker-influenced column (`email`) is validated by GoTrue.
- **Maintenance mode:** with maintenance on, Free and anonymous `/api/markets` → **503**, `/admin` as Admin → **200**
  (the exemption is the same verified-email check). Non-admins cannot escape it.

Run-1 re-attacks (all bypass attempts failed)
- **RT-01 reveal budget** (`reveal_reset.py`): dropping the `me_reveals` cookie no longer grants fresh exact
  reveals — the server-side distinct budget (3/day per IP key) is authoritative; new markets past 3 come back
  `banded, reveals_left=0`.
- **RT-02 fail-open:** the dev branch logs `rate limits are OFF (dev / demo only)`; in production without Upstash
  `limiter()` returns the per-instance `memoryLimiter` (never `noop`), and every `distinct()` budget uses the
  memory fallback even in dev (`lib/abuse.ts:160-170`, `:190-210`).
- **RT-03 row cap:** `listRoute` gates Free with `list_free` (30/min) and `rowBudget` (1,500 distinct markets/hour,
  `lib/abuse.ts:FREE_ROWS_PER_HOUR`), so filter partitioning no longer enumerates the scan unbounded, and the rows
  are banded anyway.
- **RT-04 filter oracle** (`filter_oracle.py`, anon): the binary search now converges on the **banded** values
  (`roi 20.0`, `win 0.85`) not the exact store values (`22.15 / 0.8918`). Free filters/sorts run over `freeView`
  (`lib/data/respond.ts:withTier` → `freeView`, `lib/data/gate.ts`), so thresholds are no longer an oracle.
- **RT-05 client-ref hijack** (live): a Payment Link with an edited `client_reference_id=<victim id>` →
  `checkout with an unsigned or expired client_reference_id ignored`; the victim's tier stays `pro`. The handler
  trusts only `verifyClientRef` (HMAC keyed off the webhook secret, 24 h) and refuses to re-link a user who already
  has another active customer (`lib/billing/stripe.ts:130-145`).
- **RT-06 extension daily cap** (`ext-cap-race.test.ts`): three concurrent $20.70 `place` intents →
  `[true,false,false]`, **1 order placed, 2070¢ spent** against the $25 cap. The `placing` promise chain serializes
  orders and reserves the cost before any await (`background.ts:145`).
- **RT-07 IP key:** `clientKey` never reads a client `X-Forwarded-For`; off-Vercel every anon caller shares
  `ip:local`, on-Vercel it uses `x-real-ip` / `x-vercel-forwarded-for` (`lib/abuse.ts:clientIp`). PGlite/unit proof.
- **RT-08 quotas** (DB): on Free, parallel-style inserts stop at the plan limit — `presets` 1, `alert_rules` 0,
  `watchlist` 10 — enforced by the `enforce_plan_quota` trigger with a per-user advisory lock
  (`20261118000100_plan_quotas.sql`).
- **RT-09 Kalshi scopes** (`ext-cap-race.test.ts`): `WRITE::TRANSFER`, `transfer`, `write:transfer`, `admin` are all
  **rejected** now (allow-list: `read`, `read::*`, `write::trade` only — `kalshi/trade.ts:scopeError`).
- **RT-10 extension token:** `verifyExtToken` refuses pre-RT-10 tokens (no `uid`/`iat0`) and anything past
  `EXT_TOKEN_MAX_AGE_MS` (7 days from first sign-in); `/api/ext/token/refresh` re-reads the account (deleted/banned →
  401) and re-derives the tier with the service role (`lib/trade/server.ts`, `token/refresh/route.ts`).
- **RT-11 own-row RLS** (DB): `update`/upsert of `subscriptions.tier` and `comp_tier` with a user JWT → 0 rows / RLS
  violation (no write policy); forging `profiles.accepted_terms_at` → `accepted_terms_at and created_at are set by
  the server` (trigger); `journal` insert on Free → RLS violation (insert policy requires a paid/comped plan).
- **RT-13 redirect:** signed-in `/login?next=<non-ASCII>` → **307** to `/` (no 500); `//evil.test` → `/`.
  `safeNext` is printable-ASCII and same-origin-relative only.
- **RT-14 info exposure:** `GET /api/health` unauthenticated → `{"ok":true}` only (component details need the cron
  bearer). In production without `NEXT_PUBLIC_EXTENSION_ID`, `extensionId()` is null, so no
  `chrome-extension://` origin is trusted.
- **RT-15 cache:** `/api/markets` and `/api/combos` send `Cache-Control: private, no-store` and `Vary: Cookie`.

## Run-1 fixes verified

| ID | How verified | Verdict |
|---|---|---|
| RT-01 | `reveal_reset.py` live on :3900 | Fixed |
| RT-02 | code (`limiter()` → memory in prod); dev log line | Fixed |
| RT-03 | code (`rowBudget` + `list_free` in `listRoute`); banding via `freeView` | Fixed |
| RT-04 | `filter_oracle.py` live (returns banded, not exact) | Fixed |
| RT-05 | live client-ref hijack (victim unchanged; log line) | Fixed |
| RT-06 | `ext-cap-race.test.ts` (1 order, 2070¢) | Fixed |
| RT-07 | `rt2-db.test.ts` / `clientKey` (`ip:local`) | Fixed |
| RT-08 | `rt2-db.test.ts` (quota trigger, all migrations) | Fixed |
| RT-09 | `ext-cap-race.test.ts` (scope allow-list) | Fixed |
| RT-10 | code (`verifyExtToken` + refresh re-check) | Fixed |
| RT-11 | `rt2-db.test.ts` (comp/tier/terms/journal) | Fixed |
| RT-12 | not re-exercised (body-size; Vercel 4.5 MB caps it) | Unchanged, Low |
| RT-13 | live `/login?next=` | Fixed |
| RT-14 | live `/api/health` → `{ok}` only | Fixed |
| RT-15 | live response headers | Fixed |

## Notes (not security findings)
- Maintenance mode has a ~30 s edge-cache lag (`lib/maintenance.ts` MAINT_TTL_MS) before enabling/disabling takes
  effect in middleware; observed ~11 s to enforce here. Availability toggle, not a security control.
- Off Vercel the rate-limit key and the 1,500-rows/hour distinct budget collapse to a single `ip:local` shared by
  all anonymous callers — more restrictive than per-IP, so a defensive posture rather than a bypass.

# Red-team run 3 (2026-11-18)

Scope: `origin/final` (4896b7d) checked out as `redteam3`, localhost only (ports 4750–4799). Focus: code added since run 2
(admin hardening, tier-aware `/api/meta`, the delayed Free copy, onboarding `next`, the `ops/*.mjs` launch scripts,
e2e-mock gating, rate limits on new routes, Stripe `client_reference_id`), then a regression sweep of runs 1–2.

Targets and method
- **Target B, dev + in-app mock (:4750):** `next dev` with the `playwright.paid.config.ts` env (`DEMO_MODE=false`,
  `E2E_MOCK=1`, `ADMIN_EMAILS=admin-e2e@example.com`) plus `EXT_SIGNING_SECRET`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`.
  Sessions from `ops/redteam/login.sh`: `free@x.test`, `pro@x.test`, `premium@x.test`, `admin-e2e@example.com`.
  Data: a copy of `output/` where every `markets.json`/`flags.json` question is tagged `[LIVE]` and a generated
  `markets-prev.json`/`flags-prev.json` is tagged `[PREV]` with an older `scanned_at`, so any response shows which scan
  it came from.
- **Target A, production build (:4760):** `next build && next start`, `DEMO_MODE` unset, same tagged data, and
  deliberately `E2E_MOCK=1` with Supabase pointed at the mock path (to prove the mock is dead in production).
- **DB:** `ops/redteam/run3/rt3-db.test.ts` (all migrations in PGlite, Supabase default grants) plus a re-run of
  `ops/redteam/rt2-db.test.ts` and `apps/web/test/rls.test.ts`: 25/25 pass.
- Proof scripts: `ops/redteam/run3/`. No external service was contacted. No product code changed.

## Findings

| ID | Severity | Title |
|---|---|---|
| RT3-01 | **Medium** | Free and anonymous users rebuild the exact win chance, edge and return from the public model curve plus the exact `mid` they already get (Free banding and the 3-a-day reveal budget no longer matter) |
| RT3-02 | **Medium** | `/m/<id>` and `/event/<id>` server pages have no rate limit and no row budget: 1,600 distinct markets in 20 s anonymously (bypasses the RT-03 fix) |
| RT3-03 | Low | The Free "15-minute delay" is really "one scan behind": back-to-back scans give Free data that is seconds old |
| RT3-04 | Low | Market CSV export (`toCsv`) has no formula-injection guard; only the admin export does |
| RT3-05 | Low | Admin actions are applied before the audit row is written; a failed audit write leaves a change with no record |
| RT3-06 | Low | Admin access is email + magic link only (no MFA / AAL2 requirement) |
| RT3-07 | Info | `/status` shows the live scan time and counts to Free/anon (the `/api/meta` fix made meta tier-aware; this page didn't follow) |
| RT3-08 | Info | `ops/stripe-setup.mjs --yes` with no env file prints the new `STRIPE_WEBHOOK_SECRET` unmasked |
| RT3-09 | Info | A signed `client_reference_id` expires after 24 h, but a Payment Link tab doesn't: a late payer is charged and not upgraded |

### RT3-01 · Medium · The public curve + exact `mid` un-bands every Free number

- **Where:** `apps/web/lib/data/gate.ts:28-32`: `rangeSide` bands `win_prob`/`edge`/`roi_pct` but keeps `...s`
  (exact `ask`, `mid`, `fee`, `model_level`), and `gateMarket` keeps `niche`, `market_type`, `category`, `horizon_h`.
  `apps/web/lib/data/respond.ts:122`: `marketBody` returns `curve(store.model, segment, m.horizon_h)` to every tier
  (used by `/api/markets/<id>` and `/m/<id>`). `apps/web/app/api/model/curve/route.ts:14-18`: any segment/horizon,
  no tier check, no rate limit. The engine's `win_prob` is the curve for that segment and horizon interpolated at `mid`.
- **Repro 1, detail (Free session, no `?detail=1`, so no reveal is spent):**
  `python3 -I ops/redteam/run3/curve_unband.py http://localhost:4750 free.jar pro.jar <ids…>` → **12/12 match**, e.g.
  `6627716: free shown win 0.85 edge 0.10 | derived win 0.8794 edge +0.1298 | pro exact win 0.8799 edge +0.1303 MATCH`.
- **Repro 2, list rows only, anonymous:** `curve_unband.py http://localhost:4750 - pro.jar --list` → the 25 Free
  `/api/flags` rows + **8** `/api/model/curve` calls → **25/25 within 0.5 pp** of Pro's exact numbers.
  Offline over the whole scan (`output/markets.json` + `model.json`): 88% of 13,971 markets within 0.5 pp, median
  error 0.00015.
- **Impact:** the paid "exact edge" is derivable for free. The RT-01 reveal budget and the RT-04 banding both hold
  in their own routes and are moot while this holds. The data is the product (`docs/15`).
- **Spec conflict to settle:** `docs/02-architecture.md:65` lists `/api/model/curve` as public "for charts".
  Coarsening `mid`/`ask` won't help (the ask is public on Polymarket).
- **Fix:** curve only for `can(shown, "exact_edge")`: `curve: null` in `marketBody` for Free (or a reveal), and
  `/api/model/curve` Pro+ (plus a rate limit). Decide what `/track-record` keeps: it renders the `all` and `cat:<category>`
  curves publicly, so markets modelled at `cat` level stay un-bandable unless those charts are coarsened (e.g. 10-point
  grid, rounded to 1 pp). Optionally drop `model_level` from Free rows.

### RT3-02 · Medium · Market and event pages are an unmetered scraping route

- **Where:** `apps/web/app/m/[id]/page.tsx:17-21` and `apps/web/app/event/[id]/page.tsx:14-16`: `load()` calls
  `getStoreFor(tier)` and `marketBody` with no `rateLimit`, no `rowBudget`, no `botCheck`. The RSC payload holds the
  same `MarketResponse` as the API (curve and exact `mid` included, see RT3-01).
- **Repro (production build, anonymous):** `ops/redteam/run3/page_scrape.sh http://localhost:4760 <markets.json> 1600 8`
  ```
  API detail for comparison (30 calls):   30 429
  Page /m/<id> for 1600 distinct markets: 1600 200 curve
  elapsed 20s
  ```
  The same session gets `/api/markets` 29×200 then 429, and `/api/markets/<id>` 19×200 then 429. Market ids are
  public (Polymarket's API, event pages, the screener).
- **Impact:** bypasses the RT-03 controls (`list_free` 30/min, 1,500 distinct markets/hour). With RT3-01 it is a
  full exact copy of the scan. BotID protects only the API routes listed in `docs/setup-notes/security.md`.
- **Fix:** in both pages' `load()`, apply the `markets` rule with `clientKey`, and count the id with `rowBudget`
  for Free (render the honest limit state instead of 429). Add `/m/*` and `/event/*` to the BotID-protected list.

### RT3-03 · Low · The Free delay is one scan, not 15 minutes

- **Where:** `apps/web/lib/data/store.ts:258-259` (and `loadDelayed` `:246`): when the newest scan is younger than
  `delayMin("free")`, Free gets `state.prev`/`*-prev.json` if it is merely **older** than the newest one. Nothing checks
  that it is at least the delay old. The `ponytail:` comment admits the ceiling.
- **Repro:** newest scan `scanned_at = now`, prev `= now - 60` → after the 120 s store TTL, anon and Free
  `/api/meta` → `"scanned_at":1794997289 "delay_min":15` (105 s old) while Pro gets `1794997349`. Same on the prod build.
- **Impact:** at the steady 10-minute cadence (`ops/scheduler.py:17`) Free is 10–25 min behind, not ≥15. With a
  manual re-run, a retry, or the GitHub fallback landing next to a container scan, Free is seconds behind live.
- **Fix:** serve a copy only if its `scanned_at <= cutoff`. Keep a short chain of older copies (or publish
  `*-prev.json` only when the outgoing scan is ≥ delay old). Otherwise answer `DelayedPending`.

### RT3-04 · Low · No formula guard in the user CSV export

- **Where:** `apps/web/lib/csv.ts:46-50` (`cell`) used by `toCsv` (`components/presets/ExportCsv.tsx`). The `= + - @`
  prefix guard exists only as `safe()` in `app/api/admin/export/route.ts`.
- **Repro:** none live. 0 of 13,971 current questions, events or outcomes start with `= + - @ \t \r`. The
  Question/Event/Bet columns are upstream (Polymarket/Kalshi) text, so a crafted market title would run as a formula in
  a Pro user's spreadsheet.
- **Fix:** move the prefix rule into `cell()` so every CSV in the app gets it.

### RT3-05 · Low · Mutate-then-audit

- **Where:** `apps/web/app/api/admin/route.ts:64-70, 84-86, 92-94, 101-103`: the write (settings upsert, comp,
  revoke, `deleteAccount`) runs first and `audit()` second. If the audit insert fails, the route returns 500 and the change
  stays applied with no audit row. The settings `before` value also comes from the 60 s per-instance `getSettings()`
  cache, so it can be stale.
- **Fix:** write an `intent` audit row before the change and a `done` row after it (the table is append-only, so a
  row can't be updated), or do the setting/comp change and the audit insert in one RPC transaction. Read `before`
  straight from the table.

### RT3-06 · Low · Admin = verified email, no second factor

- **Where:** `apps/web/lib/admin/server.ts:21-24`, `lib/admin/core.ts`. Anyone who controls an `ADMIN_EMAILS` inbox (or
  that Google account) gets delete-user, comp, maintenance and the user-list export.
- **Fix:** require `aal2` (Supabase MFA, TOTP) in `requireAdmin` and the middleware admin check.

### RT3-07 · Info · `/status` reads the live store

- `apps/web/app/status/page.tsx:21` uses `getStore()`. Anon sees the live "Last market scan" time and the live
  markets/best-bets counts (rounded, e.g. "2.7K"). No prices. Use `getStoreFor(tier)` for consistency with `/api/meta`.

### RT3-08 · Info · Webhook secret printed in one stripe-setup path

- `ops/stripe-setup.mjs:161`: the secret is masked only when an env file is being written. With
  `STRIPE_SECRET_KEY` in the environment and no `.env.prod`/`.env.local`, `--yes` prints `STRIPE_WEBHOOK_SECRET=whsec_…`
  in full (CI logs, scrollback). Mask it always and tell the user to read it from the dashboard. Also note
  `writeFileSync(..., { mode: 0o600 })` does not change the mode of an existing file (`secrets.mjs` adds an explicit
  `chmodSync`; stripe-setup doesn't).

### RT3-09 · Info · Signed client ref vs. a long-lived Payment Link tab

- `apps/web/lib/billing/stripe.ts:40, 55`: `verifyClientRef` rejects a ref older than 24 h, and the webhook then
  ignores the checkout (`:132-136`). A Payment Link page opened from `/api/stripe/checkout` and paid more than 24 h later
  takes the money and leaves the user on Free. The HMAC holds (domain-separated key, `timingSafeEqual`, strict format):
  this is a billing-integrity gap, not a bypass. Suggest: on an expired-but-valid-MAC ref, link by MAC only when the Stripe
  customer email equals the account email, or alert the owner.

## Attempted and held

Admin (Targets A and B)
- Non-admin (Free) to `/api/admin` path variants: `/api/%61dmin`, `/API/admin`, `/api/Admin`, `/api/admin%2Fexport`,
  `/api/admin/./export`, `/api/admin/x/../export`, `/api/admin;x`, `/api/admin/export;.css`, `/api/admin/export.json`
  → **404**; trailing slash / double slash → 308 to the canonical path (then 404). GET and POST alike.
- Production build: `/admin`, `/admin/users`, `/api/admin`, `/api/admin/export` anon → **404**.
- CSRF on `POST /api/admin`: `Origin: null`, `http://evil.test`, `http://localhost:4750.evil.test`, `http://localhost:4751`
  → **403**. `text/plain` bodies from the real origin work (JSON is parsed regardless), but a cross-site form carries a
  foreign `Origin`. (`Origin: http://LOCALHOST:4750` → 200: host names are case-insensitive, not a bypass.)
- **RT2-01 fix** (`sameSiteRequest`): `GET /api/admin/export` as admin with no headers, `Sec-Fetch-Site: cross-site`,
  `same-site`, `none`, or `Origin: https://evil.test` → **403**. Only `same-origin` → 200. (A browser can't forge
  `Sec-Fetch-Site`.) `adminOnly405`: admin `OPTIONS`/`PUT` → 405, Free `OPTIONS` → 404.
- DB (`rt3-db.test.ts`): the only `SECURITY DEFINER` functions in `public` (`admin_overview`, `admin_users`,
  `admin_user_detail`, `admin_revoke_sessions`) are **not** executable by `anon` or `authenticated` (permission denied
  for each, including revoking another user's sessions). Audit log: user JWT insert → RLS violation, select → 0 rows;
  service role update/truncate → `admin_audit_log is append-only`, `alter table … disable trigger` → `must be owner`.
- `admin_users` search escapes `\ % _` before `ilike`. Admin pages: every page and the layout call `requireAdmin()`;
  no server actions anywhere in the app.
- Maintenance on (Target B): anon/Free → **503** on `/`, `/api/markets`, `/api/meta`, `/m/<id>`,
  `/m/<id>/opengraph-image`, `/twitter-image`, `/api/markets?_rsc=1`; admin → 200 everywhere. Open by design: `/login`,
  `/auth/*`, `/api/me`, `/api/health`, `/maintenance`, `/api/stripe/webhook`, and the static root `/opengraph-image`/icons
  (matcher-excluded, no market data).
- Banner/settings values: zod-bounded (`free_rows` 1–200, `free_delay_min` 0–60, banner ≤280, React-escaped).

Tier-aware `/api/meta` and the delayed copy (Target B, tagged data)
- `/api/meta`: anon and Free get the prev scan (`delay_min 15`), Pro gets live (`delay_min 0`). Headers on every tier
  `Cache-Control: private, no-store` + `Vary: Cookie`, so no shared-cache mixing. Pages are
  `private, no-cache, no-store` in production.
- Every Free data path tested served `[PREV]` only, never `[LIVE]`: `/api/markets`, `/api/flags`, `/api/markets/<id>`,
  `/api/suggest`, `/api/events/by-slug/*`, `/m/<id>`, `/about`. Pro got `[LIVE]` on the same paths. No query parameter or
  header picks the tier: it comes only from `getMe()` (Supabase session → `subscriptions`). The OG image uses
  `getStoreFor("free")` + `gateMarket(…, "free")`.
- `/api/alerts/run` reads the live store but re-derives `effectiveTier` per user at run time and skips anyone without
  `alerts` (`lib/alerts-server.ts:61-62`), so a downgraded user's leftover rules don't email live data.

Onboarding / sign-in `next` (Target B)
- `/login?next=` with `//evil.test`, `/\evil.test`, `/%5Cevil.test`, `/%09/evil.test`, `https://evil.test` → `/`.
  `/.//evil.test`, `/%2e//evil.test`, `/x/..//evil.test` pass `safeNext` but resolve to `http://localhost:4750//evil.test`
  (our origin), which Next 308s to `/evil.test`. `/onboarding?next=` gets the same `safeNext`, and `router.push` resolves
  against our origin. No open redirect. (Hardening: normalize with `new URL(next, origin)` and require the same origin
  and no `//` prefix after normalization.)

e2e mock and production gating (Target A)
- With `E2E_MOCK=1` **in a production build**: `/e2e-mock/supabase/rest/v1/app_settings`, `/e2e-mock/supabase/_inbox`,
  `/e2e-mock/stripe/v1/customers`, `/v1/customers` → **404**. Sign-in against the mock fails closed
  (`Couldn't send the link`). In dev the mock's REST has no auth (anon can read `app_settings`), which is fine because it is
  dev-only.

Ops scripts (code read)
- `vercel-env.mjs` pushes only keys in `.env.example`, never the shell env, skips `MUST_BE_EMPTY`, marks every
  `SECRET_ENV` key `--sensitive`, feeds values on stdin (not argv), and refuses `--yes` while preflight has blockers
  (incl. `DEMO_MODE=true` and any `NEXT_PUBLIC_<secret>`). `secrets.mjs` refuses a non-git-ignored file and writes 0600.
  `supabase-setup.sh` passes the service key through a 0600 header file (`umask 077`), not argv. `mask()` shows 4 chars
  (16–24 bits of a random secret). Negligible.

Rate limits on new routes (Target A, anonymous bursts)
- `/api/markets` 29×200 then 429. `/api/markets/<id>` 19×200 then 429. `/api/meta` 120/120, `/api/model/curve`
  120/120, `/api/backtest` 60/60: unlimited, but they cost ~25 ms on a warm store. Only the curve matters (RT3-01).

Stripe `client_reference_id`
- HMAC-SHA256 keyed by `sha256("me:cref:" + webhook secret)`, strict `^[A-Za-z0-9-]{1,64}_\d{1,15}_[0-9a-f]{64}$`,
  constant-time compare, 24 h expiry. No re-link of a user who has another paying customer. Held (see RT3-09 for the
  availability side).

## Run-1 / run-2 regression

| ID | How checked (run 3) | Verdict |
|---|---|---|
| RT-01 reveals | `reveal_reset.py` on the prod build: after dropping the cookie only the 3 already-revealed ids are exact | Fixed in the route; **moot via RT3-01** |
| RT-02 fail-open | prod build: memory limiter answers 429s | Fixed |
| RT-03 row cap | `/api/markets` 429 after 29; `bulk_scrape.py` → 429 | Fixed in the API; **bypassed via `/m/<id>` (RT3-02)** |
| RT-04 filter oracle | `filter_oracle.py` → 429 before converging; Free lists are banded | Fixed in the API; **moot via the public curve (RT3-01)** |
| RT-05 client ref | code + HMAC review | Fixed |
| RT-07 IP key | `rt2-db.test.ts` (`ip:local` for any XFF) | Fixed |
| RT-08 quotas | `rt2-db.test.ts` (presets 1, alert_rules 0, watchlist 10) | Fixed |
| RT-11 own-row RLS | `rt2-db.test.ts` (tier/comp/terms/journal) | Fixed |
| RT-13 redirect | live `/login?next=` variants | Fixed |
| RT-15 cache | live headers, all tiers | Fixed |
| RT2-01 export CSRF | live `Sec-Fetch-Site`/`Origin` matrix | Fixed |
| RT-06, RT-09, RT-10, RT-12, RT-14 | not re-exercised this run (no code change since run 2) | Unchanged |

## Notes (not security findings)
- `/m/<id>/opengraph-image` is served `public, immutable, max-age=31536000`. It is Free-shaped, so no tier leak, but a
  card rendered while Free had no delayed copy (blank) or with old numbers stays on CDNs for a year.
- `/api/account/export` (a user's own data) is a GET with no `sameSiteRequest` check, same class as RT2-01. The only
  effect is the user's own file downloading to their own disk.
