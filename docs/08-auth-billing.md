# 08 · Auth & billing

## Auth (Supabase)
- Providers: Google OAuth, email + password (T-275), email magic link. `/login` and `/signup` show Google first, then
  tabs "Password" (default) and "Email link".
- Email + password (`app/api/auth/password`, `lib/auth/password.ts`): 8–72 characters (bcrypt reads 72 bytes);
  sign-in tries limited per address (`auth_password`, 5 / 15 min) and per IP; sign-up and reset emails share the
  magic-link budget (`auth_email`). Answers never reveal whether an address has an account: sign-up always says
  "check your email", "Forgot password?" always says "If that email has an account, we sent a reset link", a wrong
  password or unknown email both read "Wrong email or password".
- Sign-up requires **Supabase Auth → "Confirm email" ON**. If Supabase ever returns a session from sign-up (confirm
  off), the route deletes that user and answers 503, so nobody can claim an address they can't read.
- Reset: the email link lands on `/auth/callback`, which (only for a recovery flow requested in the same browser)
  sets a signed, account-bound, 15-minute `me_reset` cookie, then `/reset-password`. `POST /api/auth/password/update`
  needs a session and that cookie.
- Session length: the `sb-*` cookies last 400 days (`@supabase/ssr` default); how long a session stays valid is the
  refresh-token lifetime / inactivity timeout in the Supabase dashboard (Auth → Sessions), not app code.
- Account required (T-276): signed out, only `lib/auth/public-paths.ts` answers; other pages redirect to
  `/signup?next=<page>`, other API routes are 401. After sign-up or sign-in the user returns to `next` (new
  accounts see onboarding first). `/signup` copy: "10 best bets a day free, no card" (`FREE_BEST_BETS_A_DAY`, Free `best_bets_day` quota: fixed, also the size of the server's daily sample; the admin `free_rows` setting is rows per list request and never changes it).
- On first sign-in: create `profiles` and `subscriptions(tier='free')` rows (DB trigger on `auth.users` insert).
- Signup screen requires checking "I'm 18 or older and agree to the Terms" (store `accepted_terms_at`).
- Local → account migration: if `localStorage` has presets/watchlist/favorites/journal, show
  "Import 4 presets and 12 watched markets into your account?" → bulk insert, then clear local.
- Server components read the session with `@supabase/ssr`; API routes verify the JWT.

## Billing (Stripe)
Products: `Kismet Pro` ($11.99/mo, $99.99/yr), `Kismet Premium` ($19.99/mo, $169.99/yr). 7-day trial.
```
Upgrade button → POST /api/stripe/checkout {price} → Stripe Checkout (customer = stripe_customer_id or new,
  client_reference_id = user_id, trial_period_days = 7 if never trialed) → success_url /settings/billing?ok=1
Manage → POST /api/stripe/portal → Stripe Customer Portal (change plan, cancel, invoices, card)
Webhook /api/stripe/webhook (verify signature):
  checkout.session.completed      → link customer ↔ user
  customer.subscription.created|updated|deleted
                                  → upsert subscriptions {tier from price id, status, current_period_end,
                                    cancel_at_period_end}; tier = 'free' if status not in (trialing, active, past_due)
  invoice.payment_failed          → email "update your card" (Stripe handles dunning)
```
Idempotency: store processed `event.id` in a `stripe_events` table; skip repeats.

Payment risk: Stripe restricts some gambling-related businesses. Describe the product as
"prediction market analytics software". Keep Lemon Squeezy or Paddle as a fallback
(same webhook shape behind `lib/billing/provider.ts`).

## Entitlements
```ts
const LIMITS = {
  free:    { live: false, delayMin: 15, rows: 10, exactEdge: false, flagsPerDay: 3, presets: 1,
             dashboards: 0, watchlist: 10, alerts: 0, channels: [], execution: "verdict", journal: false,
             csv: false, extension: false, filters: "basic" },
  pro:     { live: true, delayMin: 0, rows: 200, exactEdge: true, flagsPerDay: Infinity, presets: 25,
             dashboards: 3, watchlist: Infinity, alerts: 20, channels: ["email","push"], execution: "full",
             journal: true, csv: true, extension: false, filters: "all" },
  premium: { ...pro, presets: Infinity, dashboards: Infinity, alerts: 100,
             channels: ["email","push","telegram","discord"], extension: true },
}
useEntitlements() // client: from /api/me; server: getEntitlements(userId) (cached 60 s)
```
Gates are enforced **server-side** in API routes (trimming fields and rows), and mirrored in the UI
with `<UpgradeGate>`. Demo mode (no auth configured) runs as `premium` so the demo shows everything, including the extension.
