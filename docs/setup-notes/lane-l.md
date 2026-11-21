# Accounts, billing, legal and SEO setup (Lane L)

Do the steps in order. Every env var named here is listed, empty, in `apps/web/.env.example` (blocks
`# --- Lane O ---` and `# --- Lane L ---`). Paste values into Vercel → Project → Settings → Environment Variables
(and `apps/web/.env.local` for local runs). Never paste a key into a file in the repo.

Until steps 1–4 are done the app runs in demo mode (`DEMO_MODE=true`): no sign-in, no billing, everything unlocked.

---

## 1. Supabase project (Auth + Postgres)

1. supabase.com → New project. Region **us-east-1** (next to Vercel `iad1`). Save the database password in your password manager.
2. Project settings → API. Copy into env:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `anon` `public` key
   - `SUPABASE_SERVICE_ROLE_KEY` = `service_role` key (server only; never in a `NEXT_PUBLIC_` var)
3. Run the migration: SQL Editor → paste `supabase/migrations/20261117000000_init.sql` → Run.
   (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
4. Optional check: run `supabase/tests/rls.test.sql` with pgTAP (`supabase test db`). It proves row-level security.
5. Authentication → URL configuration:
   - Site URL = your domain, e.g. `https://kismetodds.example`
   - Redirect URLs: add `https://<your-domain>/auth/callback` and `http://localhost:3030/auth/callback`
6. Authentication → Providers → Email: on. The app only sends magic links; it never uses passwords.
7. Authentication → Sessions: leave defaults. The 3-device limit is a database trigger from the migration.
8. Authentication → Emails → SMTP: point at Resend (Lane O, `docs/setup-notes/ops.md`) so sign-in links come from your domain.

## 2. Google sign-in

1. console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (shown on the Supabase Google provider page).
3. OAuth consent screen: app name Kismet, support email, scopes `openid email profile` only.
4. Supabase → Authentication → Providers → Google: paste Client ID and Client secret. Enable.
5. Vercel → Environment Variables: `NEXT_PUBLIC_GOOGLE_AUTH=1`, then redeploy. Until then the Google button is hidden
   (it would 400 with the provider off) and sign-in is email link only.

## 3. Stripe

Use **test mode** first; repeat with live keys when you launch.

1. dashboard.stripe.com → Products → add **Pro** and **Premium**, each with a monthly and a yearly recurring price
   matching `config/site.json` → `prices_usd` (11.99 / 119.99 / 19.99 / 199.99). Copy the four price ids into
   `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY`.
   **Changing a price later:** `node ops/stripe-setup.mjs --yes` creates the new price but never overwrites a price id
   already in your env file (it prints "replace it by hand"). Paste the new ids into `.env.prod` and Vercel, or
   Checkout keeps selling the old price. Payment Links mode: set the 7-day trial on each link in the dashboard.
2. Developers → API keys → `STRIPE_SECRET_KEY` (secret key; restricted key with Checkout, Customers, Subscriptions, Billing Portal write is fine).
3. Developers → Webhooks → Add endpoint `https://<your-domain>/api/stripe/webhook`, events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Settings → Billing → Customer portal: turn on cancel, switch plan (both products), update payment method. Save.
5. Local testing: `stripe listen --forward-to localhost:3030/api/stripe/webhook` and use the `whsec_…` it prints.

**Payment Links instead of Checkout** (no price ids in env): set `config/site.json` → `stripe.mode` to `"links"`, paste
the four Payment Link URLs into `stripe.paymentLinks`, and optionally the portal login link into `stripe.portal_url`
(or `STRIPE_PORTAL_URL`). Give each price a metadata key `tier` = `pro` or `premium`. You still need
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Set each link's after-payment page to `https://<your-domain>/account?checkout=success`.

**Signed `client_reference_id` (RT-05):** Checkout sessions and Payment Links carry `<user id>_<expiry>_<HMAC>`, keyed
from `STRIPE_WEBHOOK_SECRET` (no new env value). The webhook links a Stripe customer only when the signature checks out
and the reference is less than 7 days old (RT3-09: a Payment Link tab left open and paid days later still upgrades
the user; past 7 days the webhook ignores it: the owner refunds it in Stripe or comps the user from `/admin`). It never re-links a user who already pays through another customer.
Rotating the webhook secret voids open checkout links. Users click "Upgrade" again to get a new one.

With any Stripe value missing, pricing buttons say "Coming soon" and a dev-only banner says Stripe isn't configured.

## 4. Turn accounts on

Set `DEMO_MODE=false` (the browser flag `NEXT_PUBLIC_DEMO_MODE` follows it automatically). Redeploy.

## 5. Owner values for legal pages (`config/site.json`)

Fill every empty string. Until then the pages show `[[PLACEHOLDER]]` text:
`domain`, `support_email`, `legal.operator_names`, `legal.governing_state`, `legal.mailing_address` (optional),
`legal.refund_policy` (`none`, `first_charge_7_days`, `prorated`, or your own sentence), `legal.response_time`
(e.g. "2 business days"), `legal.last_updated` (e.g. "November 17, 2026").
Have a lawyer read `/terms`, `/privacy`, `/refunds`, `/disclaimer` before launch; the dev banner says so.
Trading terms appear on `/terms` only when `KALSHI_TRADING_ENV` is set.

## 6. SEO

Set `NEXT_PUBLIC_SITE_URL` (Lane O block) to the canonical origin. `robots.txt` and `sitemap.xml` use it.
Add `/about` to `apps/web/app/sitemap.ts` once the landing page moves there.
Google Search Console → add the domain → submit `https://<your-domain>/sitemap.xml`.

## Tests

- `pnpm test`: includes RLS tests on an in-process Postgres (PGlite), webhook signature/idempotency/tier mapping, tier contract tests.
- `pnpm e2e`: demo flows, then the paid flows (`playwright.paid.config.ts`: sign up → upgrade → Pro unlocks; account delete)
  against an in-app Supabase/Stripe mock that only runs with `E2E_MOCK=1` outside production. Leave `E2E_MOCK` and
  `STRIPE_API_BASE` empty everywhere else.
