# 14 · Launch: accounts, billing, hosting, legal, audit

Goal: turn the demo into a paid website. Everything here must work with **placeholders** until the
owner pastes real keys and links into `.env` / `config/site.json` (see `SETUP.md`, which the build creates).

## 1. Accounts (Supabase Auth)
- Sign-in page `/login`: "Continue with Google", then email + password (default tab) or an email magic link (T-275).
- Sign-up flow: 18+ and Terms checkbox (required) → onboarding (topics) → Best bets.
- Logged-out visitors can browse Best bets and All markets on the **Free** tier (delayed, capped);
  saving, alerts, My bets, dashboards prompt sign-in.
- First sign-in imports local data (presets, My list, My bets, alerts) into the account, then clears local.
- `/account`: email, plan, billing portal button, data export (JSON), delete account (confirm by typing email;
  deletes rows and Supabase user; cancels Stripe subscription).
- Session: `@supabase/ssr` cookies (HttpOnly, Secure, SameSite=Lax). Sign out everywhere button.
- Device limit: max 3 active sessions per account (stops account sharing); oldest is signed out.

## 2. Billing (Stripe) with paste-in placeholders
Two supported ways; the owner picks by filling config:
1. **Checkout (preferred)**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`,
   `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY` in `.env`.
2. **Payment Links (fallback, zero code on the owner's side)**: paste 4 links into `config/site.json`
   (`stripe.paymentLinks.pro_monthly` …). The app appends `?client_reference_id=<user_id>&prefilled_email=<email>`
   so the webhook can match the user.
Both use the same webhook (`/api/stripe/webhook`, signature verified, idempotent via `stripe_events`) to set
`subscriptions.tier`. Customer Portal link: `STRIPE_PORTAL_URL` or created via API.
While keys are empty: pricing buttons show "Coming soon" and the app stays usable on Free; a dev-only
banner says "Stripe not configured". `DEMO_MODE=true` still unlocks everything locally.
Trial: 7 days on Pro and Premium (Stripe-side setting). Prices from `docs/01-product.md`.

## 3. Legal and trust pages
Generated from `config/site.json` → `legal` (owner fills names, email, state). Drafts in plain English,
each with "Last updated" and a banner in dev: "Draft — have a lawyer review before relying on this".
| Page | Must cover |
|---|---|
| `/terms` | Service description (analytics software, not a broker, not financial advice; order placement only if trading is enabled (docs/16), with its own risk terms); 18+; user responsibilities and venue rules; subscription, auto-renew, cancellation; acceptable use (no scraping, no reselling data, no automated access, no account sharing); IP; disclaimers and limitation of liability; governing law; changes; contact |
| `/privacy` | What we collect (account email, settings, saved items, bet journal entries the user types, payment status via Stripe, analytics, logs); what we don't (no card numbers, no wallet keys, no positions pulled from venues); purposes; processors (Supabase, Vercel, Stripe, Resend, PostHog, Sentry); retention; user rights (access, delete, export; CCPA "we don't sell personal information"); cookies; children (not for under 18); contact |
| `/refunds` | Cancel anytime from the account page; access continues to period end; refund policy (owner picks: none / first-charge within 7 days / prorated); how to request; timeline |
| `/disclaimer` | Not financial or betting advice; estimates from past data; you can lose money; venue availability depends on where you live; responsible-trading resources (1-800-GAMBLER, ncpgambling.org) |
| `/contact` | Support email (from config), response time, mailing address if provided |
| Footer (every page) | Disclaimer line, links to all of the above, © year + operator name |
Stripe expects a business site to show what you sell with prices, customer service contact details, a refund
and dispute policy, a cancellation policy, and a privacy policy (docs.stripe.com/get-started/checklist/website).
Cookie banner: only needed if non-essential cookies are used for EU/UK visitors; use cookieless PostHog mode
or show a simple consent banner (choose cookieless).

## 4. Hosting (cheap, reliable, under ~$30/month)
| Piece | Where | Cost |
|---|---|---|
| Web app + API + cron (alerts, settlement) | Vercel (Hobby to start; Pro when charging customers — Hobby is non-commercial) | $0 → $20 |
| Database + auth + file storage for scan output | Supabase Free → Pro when needed | $0 → $25 |
| Engine (update/fit/scan, Python) | Railway or Fly.io scheduled job, Dockerfile in repo, every 10 min scan, hourly update+fit, daily backtest | ~$5 |
| Email | Resend (free tier), domain with SPF/DKIM/DMARC | $0 |
| Rate limiting | Upstash Redis (free tier) | $0 |
| Errors / uptime | Sentry (free), Better Stack or UptimeRobot (free) | $0 |
| Domain | any registrar | ~$12/yr |
Data path in production: engine uploads `output/*.json` to a **private** Supabase Storage bucket `scan/` (service
key, server only); the web server reads from there (`DATA_SOURCE=supabase`), falls back to the GitHub `live`
branch, then to the last good copy in memory. Keep `DATA_SOURCE=local` for development.

## 5. Ops
- Health: `/api/health` (data age, DB reachable, Stripe configured) for the uptime monitor; alert if data > 30 min old.
- Logs: structured server logs (no PII in logs, no tokens); Sentry with PII scrubbing.
- Backups: Supabase daily backups (Pro) or a nightly `pg_dump` job to storage.
- Emails: transactional only (magic links, alerts, receipts via Stripe). Every alert email has a one-click
  unsubscribe; include the operator's mailing address if marketing emails are ever added (CAN-SPAM).
- Analytics: PostHog cookieless; events from `docs/10` T-64. Never send market data or emails as properties.

## 6. SEO and sharing
Metadata per page, OG images (exist), `sitemap.xml` (public pages only), `robots.txt` (allow landing/about/pricing/
legal; disallow `/api/`, app pages behind auth; block known AI crawlers — they may still ignore it, so also
enforce in `docs/15`). Canonical domain, 404/500 pages that match the design.

## 7. Pre-launch audit (the agent runs this, writes `AUDIT.md`)
Functional: every page loads logged out / free / pro / premium (seeded test users); every docs/12 flow;
upgrade → webhook → tier changes → downgrade on cancel; delete account works end to end.
Quality: Lighthouse ≥ 90 performance/accessibility/best-practices on Best bets and landing (mobile);
axe has no serious violations; no console errors; all pages at 390 px; keyboard reachable.
Security: everything in `docs/15` checklist, with evidence.
Data: freshness < 15 min in production; numbers on cards match `/api` responses; no NaN/undefined anywhere.
Legal: all pages present and linked; disclaimer everywhere; no banned words (grep).
Billing: Stripe test mode end-to-end; placeholders documented.
Each item: pass/fail + how it was checked. Fix fails before finishing.
