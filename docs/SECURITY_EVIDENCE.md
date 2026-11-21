# Security evidence (docs/15)

Each control in `docs/15-security.md` mapped to where it is enforced and what proves it.
Test paths are relative to `apps/web` unless they start with `apps/`, `ops/`, `supabase/` or `.github/`.
"Owner" means a dashboard setting nobody can test from the repo; steps are in `docs/setup-notes/`.

Run everything: `cd apps/web && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e && pnpm build && pnpm check:bundle`.

## Paywall and data

| Control | Enforced in | Evidence |
| --- | --- | --- |
| Gating is server-side; the client gets only the fields its tier allows | `lib/data/gate.ts`, `lib/data/respond.ts` (`withTier`, `marketBody`, `listRoute`), server pages `/`, `/about`, `/m/[id]`, `/event/[id]` | `test/paywall.test.ts` checks every data route for anon, free, pro and premium. `e2e-paid/paywall-pages.spec.ts` checks the server-rendered HTML when signed out. |
| Account required (T-276): signed out, only public pages/APIs answer; teasers carry no model output | `middleware.ts` (`accountWall`), `lib/auth/public-paths.ts`, `lib/teaser.ts`, `app/api/events/by-slug` | `test/account-wall.test.ts`, `test/teaser.test.ts`, `e2e-paid/paywall-pages.spec.ts` (401s, redirects, no 401 calls from public pages, sign-up round trip). |
| The full `markets.json` is never served | The server loads it (`lib/data/store.ts`); routes return at most 200 rows | `test/paywall.test.ts` (row caps); no route or static file serves the raw file |
| Scan output is private; only the server reads it | `lib/data/store.ts` (`import "server-only"`; Supabase bucket read with the service key, or the GitHub `live` branch with a token) | Owner: keep the bucket private (`docs/setup-notes/security.md`) |
| Free: at least a 15-min delay, also on a cold instance (RT3-03) | `getStoreFor()` serves the newest scan whose `scanned_at` is at least the delay before now: the newest itself, `*-prev.json` or `*-prev2.json`; none old enough = 503 pending. The publishers keep the two scans before the newest (`engine scan_keeping_prev`, `ops/upload.py`, `.github/workflows/refresh.yml`). | `test/delay.test.ts`, `test/tiers.test.ts`, `ops/tests/test_ops.py::test_upload_keeps_previous_scan_for_the_free_delay`, `engine/tests/test_prev_rotation.py` |
| Free: 10 rows (Best bets: daily seeded sample), page 1 only, returns shown as ranges | `gateMarkets`, `rangeSide`, `listRoute`, `freeSample` | `test/paywall.test.ts`, `test/tiers.test.ts` |
| Free: 3 drawers revealed a day | `lib/data/reveals.ts` (`drawer_reveals` table, or a cookie when signed out) | `test/tiers.test.ts` ("details panel") |
| `page_size ≤ 200`; 50 pages a minute; a page past the last is refused | `lib/filters`, `listRoute`, `RULES.pages` in `lib/abuse.ts` | `test/paywall.test.ts` (400 past the last page), `test/ratelimit.test.ts` (50 pages a minute) |
| No model internals (theta, cov, knots) | `lib/data/gate.ts` | `test/paywall.test.ts` (`INTERNALS`) |
| DEMO_MODE fails safe: on only when exactly `true`, or unset outside production | `lib/config.ts` (`demoFlag`) | `test/security.test.ts` |

## Bots and abuse

| Control | Enforced in | Evidence |
| --- | --- | --- |
| Vercel Firewall: Bot Protection, AI Bots set to deny, OWASP | Owner (dashboard or `vercel firewall` CLI) | `docs/setup-notes/security.md`. OWASP needs the Enterprise plan. |
| BotID on markets, flags, events, suggest, book, magic link and checkout | `lib/abuse.ts` (`botCheck`), `instrumentation-client.ts` (`initBotId`), `next.config.ts` (`withBotId`); active only on Vercel | No test: it is a pass-through off Vercel. Code path in `withTier` and `guard`. `/api/auth/google` and `signout` are plain form POSTs, so they are rate limited only. |
| Rate limits: Upstash sliding window, by user id else IP + JA4, 429 with Retry-After | `lib/abuse.ts` (`RULES`, `clientKey`, `rateLimit`) on every listed route, plus `/api/settle` | `test/ratelimit.test.ts` covers each limit. Off without Upstash env, which is required in production (`docs/setup-notes/security.md`). |
| robots.txt disallows `/api/` and blocks AI crawlers; AI crawlers get 403 anyway | `app/robots.ts`, `lib/bots.ts`, `middleware.ts` | `test/security.test.ts` ("AI crawlers"), `test/seo.test.ts` |
| 3 sessions per account | `enforce_session_limit` trigger (`supabase/migrations/…_init.sql`) | `test/rls.test.ts` ("keeps at most 3 sessions") |
| Anomaly log over 5,000 rows/hour | `noteRows` in `lib/abuse.ts` | `test/ratelimit.test.ts` ("anomaly log") |
| Terms forbid scraping, automated access and reselling | `app/terms/page.tsx` | Page text |

## Auth

| Control | Enforced in | Evidence |
| --- | --- | --- |
| Supabase email confirmations, OTP expiry, rate limits, redirect allow-list | Owner (Supabase dashboard) | `docs/setup-notes/lane-l.md` |
| Google OAuth: production origin only; scopes `openid email profile` | `app/api/auth/google/route.ts` (scopes); origin is set by the owner | Code; `docs/setup-notes/lane-l.md` |
| Cookies HttpOnly, Secure (in production), SameSite=Lax; refreshed in middleware | `COOKIE_OPTIONS` in `lib/auth/server.ts` and `middleware.ts` | `test/security.test.ts` ("cookie flags"): every cookie the server sets spreads `COOKIE_OPTIONS`, and there is no `document.cookie` |
| Admin routes check `ADMIN_EMAILS` | N/A: there are no admin routes | `grep -r ADMIN apps/web` finds nothing |
| Magic-link and auth abuse | `app/api/auth/*`: Origin check, 5/min per IP, 5 per 15 min per email | `test/ratelimit.test.ts` |

## Database

| Control | Enforced in | Evidence |
| --- | --- | --- |
| RLS on every table; user B and anon see nothing of A's | `supabase/migrations/…_init.sql` | `test/rls.test.ts` runs the real migration in PGlite. It lists all 11 tables, including `stripe_events` (service role only), and checks for each one: anon reads, B reads, B deletes, and B inserting as A. It also checks `auth.sessions` is not reachable. Real DB: `supabase/tests/rls.test.sql`. |
| `rowsecurity` true for every public table | Migration | `test/rls.test.ts` ("every public table has row level security on") |
| Service key only in server files; a secret in the client bundle fails the build | `import "server-only"` in `lib/data/store.ts`, `lib/auth/server.ts`, `lib/trade/server.ts`, `lib/billing/stripe.ts`, `lib/email/index.ts`, `lib/cron.ts`, `lib/abuse.ts` | `scripts/check-bundle.mjs` (`pnpm check:bundle`, a CI step after `pnpm build`) checks for secret env names, key shapes and actual values |
| `security definer` only where needed, with `search_path` set | `handle_new_user`, `enforce_session_limit` | `test/rls.test.ts` ("security definer functions…"): exactly these two, `search_path=""`, not executable by anon or authenticated |
| Supabase Security Advisor clean | Owner | Run it after `supabase db push` |

## Billing

| Control | Enforced in | Evidence |
| --- | --- | --- |
| Webhook checks the signature on the raw body, rejects old timestamps, is idempotent by `event.id` | `app/api/stripe/webhook/route.ts`, `lib/billing/stripe.ts` | `lib/billing/stripe.test.ts` |
| Tier comes only from webhook-written rows | `getTier()` reads `subscriptions`; RLS blocks users from writing it | `test/rls.test.ts` ("users can't write their own tier"), `lib/billing/stripe.test.ts` |
| The success page grants nothing; it waits for the webhook | `/account?checkout=success` polls `/api/me` | `e2e-paid/s7-upgrade.spec.ts` |
| Checkout is rate limited and Origin-checked | `app/api/stripe/checkout/route.ts` | `test/ratelimit.test.ts`, `test/security.test.ts` (Origin grep) |

## Web hardening

| Control | Enforced in | Evidence |
| --- | --- | --- |
| Strict CSP: per-request nonce, `strict-dynamic`, no `unsafe-eval` in production, `frame-ancestors 'none'`, `object-src 'none'` | `middleware.ts` (`csp()`); `app/layout.tsx` makes every page dynamic so the nonce is never stale | `e2e/headers.spec.ts` (against `next start`): every `<script>` carries the nonce, the nonce changes per request, and pages hydrate with no CSP violations |
| HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options DENY, no `X-Powered-By` | `next.config.ts` `headers()` | `e2e/headers.spec.ts`. HSTS `preload` is left off until after launch, as the spec says. |
| Market text rendered as text, never as HTML | React escaping; no `dangerouslySetInnerHTML` | `test/security.test.ts` (grep). Extension: text from the API goes through `esc()` (`apps/extension/src/sidepanel.ts`), inside a closed shadow root (`content.ts`). |
| Every API input parsed with zod; unknown keys rejected; numbers bounded | Every `app/api/**` schema, `lib/trade/intent.ts`, `lib/repo/schemas.ts` | `test/security.test.ts`: every `z.object` in those files is `.strict()`. List routes go through the URL filter parser (`lib/filters`), which keeps only known keys. Path ids are only Map lookup keys. |
| Pasted Polymarket URLs are parsed locally, never fetched | `lib/search/parse.ts` | `lib/search/parse.test.ts` |
| Outbound fetches only to the allow-list | Literal hosts in server code | `test/security.test.ts`: every `https://` host in a file that calls `fetch` must be one of `api.github.com`, `api.resend.com`, `clob.polymarket.com` or `gamma-api.polymarket.com`. Supabase comes from env. Stripe goes through its SDK. |
| Alert webhooks: Discord and Telegram URLs only | `lib/repo/schemas.ts` (`webhook_url` regex) | `test/security.test.ts` ("alert webhooks": look-alike hosts, http and other paths rejected), `test/rls.test.ts` (B can't set A's webhook) |
| CSRF: Origin check on every mutation | `sameOrigin()` (one copy, `lib/auth/server.ts`); `siteOrExtension()` for `/api/ext/token`; `withUser` for `/api/data/*` | `test/security.test.ts`: every mutating route checks Origin, or is listed with the credential it uses instead (Stripe signature, signed token, Bearer, nonce, CRON_SECRET). Includes unit tests for `/api/settle` and `/api/ext/token`. |
| Open redirects: `next=` is a same-origin relative path | `safeNext()` | `lib/auth/server.test.ts` |

## Secrets and supply chain

| Control | Enforced in | Evidence |
| --- | --- | --- |
| `.env*` git-ignored; full-history secret scan | `.gitignore` (`.env*`, `!.env.example`) | CI job `supply-chain` runs `gitleaks` with `fetch-depth: 0`. A local regex scan of all 164 commits (`git log -p --all`) for Stripe, Resend, GitHub, AWS and Slack keys, JWTs and PEM keys found only placeholders and test stubs. No `.env` or key file was ever committed. |
| `pnpm audit --prod`: no high or critical; Dependabot; lockfiles committed | `.github/dependabot.yml` (web, extension, pip, docker, actions) | Web: 2 moderate, both in `@sentry/nextjs` build-time tooling (glob, minimatch), and no high. Extension: none. CI fails on high. Python: `requests`, `urllib3`, `certifi` and `idna` bumped to patched versions; `pip-audit` is clean on `requirements.txt` and `ops/requirements.lock`, and runs in CI. |
| GitHub data token: fine-grained, read-only, one repo | Owner | `.env.example` comment on `GITHUB_DATA_TOKEN` |
| Engine runs as non-root | `engine/Dockerfile` (uid 10001, root drop in `ops/scheduler.py`) | Code. Outbound network limits are an owner setting on the host. |

## Trading keys

| Control | Enforced in | Evidence |
| --- | --- | --- |
| Kalshi keys never reach our servers; non-extractable WebCrypto key in IndexedDB | `apps/extension/src/kalshi/sign.ts`, `vault.ts` | `apps/extension/test/sign.test.ts` ("imports non-extractable"); the server has no Kalshi signing code |
| Reject `write::transfer` and full `write`; require `read` + `write::trade` | `scopeError()` in `apps/extension/src/kalshi/trade.ts` | `apps/extension/test/trade.test.ts` ("scopes") |
| Explicit confirmation, spend caps, no auto-trading | Ticket confirm handler; extension `capError` | `lib/trade/no-auto-trade.test.ts`, `apps/extension/test/no-auto-trade.test.ts` (an order is placed only from the confirm handler; no timers or batches), `apps/extension/test/trade.test.ts` (caps) |
| One-time nonce bound to the exact order; `externally_connectable` limited to our origin | `lib/trade/server.ts`: used nonces go to Upstash `SET NX` across instances and fail closed if the store errors. A production deploy refuses to sign with a made-up key. `.strict()` intents. `apps/extension/manifest.config.ts`. | `lib/trade/trade.test.ts` (bound, one-time, expiry, tampering, `SET NX` across instances, store error, no secret in production) |
| Trading off unless `KALSHI_TRADING_ENV=demo` | `tradingEnv()` | `lib/trade/trade.test.ts` ("trading flag") |

## Extension

| Control | Enforced in | Evidence |
| --- | --- | --- |
| Minimal permissions | `apps/extension/manifest.config.ts`: `storage`, `sidePanel`; hosts are our API and the Kalshi demo host; the content script runs only on `polymarket.com/event/*` and `/sports/*` | Manifest |
| Token in `chrome.storage.session`, short-lived, refreshed | `apps/extension/src/background.ts`; 30-minute tokens from `/api/ext/token` (Origin: our site or our extension ID) | `lib/trade/trade.test.ts` ("extension token"), `test/security.test.ts` (`siteOrExtension`) |
| Content script renders in a shadow root; never injects API HTML | `apps/extension/src/content.ts` (closed shadow root, static markup); `sidepanel.ts` `esc()`; extension CSP `script-src 'self'` | Code review (this file) |

## Known gaps

- Rate limits and the anomaly log are off without Upstash. In live production `/api/health` then reports `ratelimit: "off"` and answers 503, so the uptime monitor alerts (`test/health.test.ts`).
- `/api/combos` (BotID, 60 a minute, Free gets a return band and win chances floored to 5%), `/api/flags?tier=edge|all` (same Free shaping and 25-row cap) and `POST /api/combos/kalshi` (Origin, 30 a minute, `.strict()`) are covered by `test/paywall.test.ts` and `test/security.test.ts`. `/api/alerts/run` and `/api/settle/run` take no input and need `CRON_SECRET`; webhook posts re-check the URL prefix and refuse redirects.
- Server pages (`/m/[id]`, `/event/[id]`) are not rate limited. They render the Free shape for anonymous visitors, so they leak nothing beyond what Free already sees.
- The reveal count for signed-out visitors is a cookie, so clearing cookies resets it. Revealed details are Free-tier data.
- `alert_events.dedupe_key` is unique across all users, not per user. A collision only blocks an insert; RLS still hides the rows.
- A signing key is made up per process only in demo mode and never when `VERCEL_ENV=production`. A self-hosted production build with `DEMO_MODE=true` would still make one up; this is kept so the e2e production build can run paper trading.
- `/api/ext/telemetry` takes no sign-in. It is rate limited to 30 a minute per IP.
- The CSP keeps `style-src 'unsafe-inline'`, because React `style` attributes need it. There is no `form-action`, because the OAuth and Stripe redirect chains would need every hop listed.
