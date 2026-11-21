# 15 · Security

## What we're protecting, and from whom
| Asset | Threat | Why it matters |
|---|---|---|
| The scan data (win chances, returns) | Scrapers and AI bots copying it; free users bypassing the paywall | The data **is** the product |
| User accounts | Credential stuffing, magic-link abuse, account sharing | Paid access resold or shared |
| Billing state | Forged webhooks, client-side tier spoofing | Free Premium |
| Secrets (Supabase service key, Stripe key, GitHub token) | Leaks in client bundles or the repo | Full database / money access |
| Infrastructure bill | Bot floods on expensive routes (`/api/markets`, `/api/suggest`, `/api/book`) | Cost and downtime |
| Users | XSS via market text, open redirects, phishing look-alikes | Trust |

## Controls (each is a checklist item in AUDIT.md)
### Paywall and data
- [ ] All gating is server-side in API routes and server components; the client never receives fields the
      tier doesn't allow (contract tests per tier). The full `markets.json` is never served or publicly reachable.
- [ ] Scan output lives in a private bucket / private repo branch; only the server reads it.
- [ ] Free tier: at least a 15-min delay (the newest scan that old, RT3-03), 10 rows per request (Best bets: the day's seeded sample of 10, docs/19 P3), return shown as ranges, max 3 drawers/day revealed.
- [ ] Pagination cap: `page_size ≤ 200`, max 50 pages per minute per user; deny `page` beyond total.
- [ ] Response shaping: no raw model internals (theta, covariance) to non-admin users.

### Bots and abuse
- [ ] Vercel Firewall: Bot Protection managed ruleset on, AI Bots ruleset set to deny, OWASP rules on.
- [ ] Vercel BotID (`checkBotId()`) on `/api/markets`, `/api/flags`, `/api/suggest`, `/api/book`, `/api/auth/*`,
      `/api/stripe/checkout`.
- [ ] Rate limits (Upstash, sliding window), keyed by user id when signed in, else IP + JA4 where available:
      markets/flags 60/min, suggest 120/min, book 30/min, auth 5/min/IP and 5 per 15 min per email (emails sent and password tries, separate buckets), checkout 10/hour.
      429 with `Retry-After`.
- [ ] `robots.txt` disallows `/api/` and blocks AI crawlers (GPTBot, ClaudeBot, CCBot, PerplexityBot, Google-Extended…).
- [ ] Session limit: 3 active sessions per account; anomaly log when one account pulls > 5,000 rows/hour.
- [ ] Terms forbid scraping, automated access and reselling (enforceable basis for bans).

### Auth
- [ ] Supabase: email confirmations on, magic-link OTP expiry 15 min, rate limits on, leaked-password protection on (email + password, T-275), min length 8,
      redirect URL allow-list = production domain + localhost only.
- [ ] Google OAuth client limited to the production origin; only `openid email profile` scopes.
- [ ] Cookies HttpOnly, Secure, SameSite=Lax; session refresh in middleware.
- [ ] Admin routes check an allow-list server-side (`ADMIN_EMAILS`), never a client flag.

### Database (Supabase)
- [ ] RLS enabled on **every** table; policies `user_id = (select auth.uid())`; test as anon and as user B (must see nothing).
- [ ] `select tablename, rowsecurity from pg_tables where schemaname='public'` → all true (put in a test).
- [ ] Service role key only in server files (grep for it in client bundles = build failure); never `NEXT_PUBLIC_`.
- [ ] Supabase Security Advisor: no warnings. Functions `security definer` only where needed, with `search_path` set.

### Billing
- [ ] Webhook verifies the Stripe signature with the raw body; rejects old timestamps; idempotent by `event.id`.
- [ ] Tier comes only from webhook-written rows, never from query params or the client.
- [ ] Checkout success page does not grant access; it waits for the webhook (poll `/api/me`).

### Web hardening
- [ ] Security headers (next.config): strict CSP (self + Supabase + Stripe + PostHog + Vercel insights; no `unsafe-eval`
      in prod), HSTS (preload after launch), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
      `Permissions-Policy` minimal, `frame-ancestors 'none'`.
- [ ] All market text (questions, outcomes, event titles come from a third party) rendered as text, never HTML.
- [ ] Every API input parsed with zod; unknown keys rejected; numbers bounded.
- [ ] Search box accepts pasted Polymarket URLs: parse locally, never fetch arbitrary URLs server-side (no SSRF).
- [ ] Outbound fetches only to an allow-list: `gamma-api.polymarket.com`, `clob.polymarket.com`, Supabase, Stripe, Resend.
- [ ] Alert webhooks (Discord/Telegram): only `https://discord.com/api/webhooks/…` and `https://api.telegram.org/…` URLs accepted.
- [ ] CSRF: mutations only via POST/PUT/DELETE with SameSite cookies + Origin header check.
- [ ] Open redirects: `next=` params must be same-origin relative paths.

### Secrets and supply chain
- [ ] `.env*` git-ignored; `gitleaks` scan of the whole history passes (rotate anything found).
- [ ] `pnpm audit --prod` has no high/critical; Dependabot on; lockfile committed.
- [ ] GitHub token for data is fine-grained, read-only, one repo.
- [ ] Engine container runs as non-root; only outbound network to Polymarket + Supabase.

### Trading keys (docs/16)
- [ ] Kalshi private keys never reach our servers, logs, analytics or error reports; they live only in the extension (non-extractable WebCrypto key / encrypted `chrome.storage.local`).
- [ ] Reject keys that carry `write::transfer` or other non-trade write scopes; require `read` + `write::trade` only.
- [ ] Every order needs an explicit user confirmation; per-order and per-day spend caps set by the user; no auto-trading code paths exist.
- [ ] `client_order_id` on every order (idempotent retries); order intents from the web app are signed with a short-lived nonce so another site can't trigger orders through the extension (`externally_connectable` limited to our origin).
- [ ] Trading is disabled unless `KALSHI_TRADING_ENV` is set; production stays off until docs/16 §5 sign-offs are done.

### Extension
- [ ] Manifest permissions minimal (`storage`, `sidePanel`, host `https://polymarket.com/*` + our API).
- [ ] Token stored in `chrome.storage.session`, short-lived, refreshed by the background worker.
- [ ] Content script renders in a shadow root and never injects HTML from the API.
