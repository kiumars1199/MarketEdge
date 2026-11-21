# Launch to-do (owner only)

**Scripted runbook: [`ops/ship.md`](ops/ship.md). It covers items 1, 3, 4 and 6 below with commands.**

Code can't do these. Do them in order. `SETUP.md` has the how-to for every account and key.

## Before charging money

1. **Fill `config/site.json`.** Fill in: `domain`, `support_email`, `legal.operator_names`, `legal.governing_state`,
   `legal.mailing_address` (optional), `legal.refund_policy` (`none`, `first_charge_7_days`, `prorated`, or your
   own sentence), `legal.response_time`, `legal.last_updated`. Until these are filled, the site shows
   `[[PLACEHOLDER]]` text on the legal pages and in emails.
2. **Get a lawyer to review** `/terms`, `/privacy`, `/refunds`, `/disclaimer` and `/contact`. The pages are plain-English
   drafts. A banner says so in development.
3. **Create production accounts and paste the keys** (SETUP.md order): Supabase, Google OAuth, Stripe, Resend (with
   SPF/DKIM/DMARC verified), Upstash, Sentry, PostHog, Railway or Fly (engine), Vercel.
4. **Switch Stripe to live mode.** Create live products and prices (or 4 live Payment Links). Add the live webhook
   endpoint and the live keys in Vercel. Then make one real purchase, cancel it in the portal, and refund it.
5. **Move to Vercel Pro.** Hobby is non-commercial, and it rejects the 5-minute alerts cron.
6. **Set `DEMO_MODE=false`** in Vercel production and redeploy. Check that `/api/health` returns 200, that a fresh
   account lands on the Free tier, and that pricing buttons open Checkout.
7. **Set up Supabase backups**: Pro daily backups, or a nightly `pg_dump`.
8. **Turn on the Vercel Firewall rules**: Bot Protection, AI Bots = deny, OWASP. Details are in
   `docs/setup-notes/security.md`.
9. **Publish the Chrome extension**: build `cd apps/extension && pnpm i --frozen-lockfile && KISMET_ORIGIN=https://<domain> pnpm ext:zip` and upload it. Then set
   `NEXT_PUBLIC_EXTENSION_ID` to the store ID and redeploy.
10. **Run a data refresh for 48 hours** before launch. Both of these must be green: the Railway/Fly engine logs, and
    `refresh.yml` as the fallback.
11. **Protect admin access (RT3-06).** Turn on two-factor on both admin Google accounts and inboxes. Enable TOTP in
    Supabase → Authentication → Multi-Factor. Admin should require `aal2`: build the small admin TOTP enroll/verify
    screen, enroll both admins, then set `ADMIN_REQUIRE_MFA=true` in Vercel and redeploy
    (`docs/setup-notes/admin.md` § MFA). Don't set the flag before the screen exists: it locks admins out.

12. **Add 2 GitHub Actions secrets** (repo Settings → Secrets and variables → Actions) so the 30-minute refresh
    (`.github/workflows/refresh.yml`) uploads each scan to the Supabase bucket `scan`: `SUPABASE_URL` (the project URL,
    `https://<ref>.supabase.co`) and `SUPABASE_SERVICE_ROLE_KEY`. Until both are set the upload step is skipped with a
    warning and the site reads the GitHub `live` branch instead.

## Before real-money trading (docs/16 §5) — trading stays paper-only until all of these are done

1. Email Kalshi partnerships about a data license and a partner integration for a third-party trading front end.
   Ask whether they will sign the CFTC Staff Letter 26-25 joint-liability undertaking.
2. Have a **CFTC/NFA lawyer** review whether analytics plus an order ticket requires introducing-broker
   registration, and how to structure it.
3. If you go ahead under 26-25: file the notice, add conflict and risk disclosures with a recorded acknowledgment,
   adopt NFA-style marketing policies, and set up recordkeeping.
4. Only after steps 1–3 should anyone change the code to allow `KALSHI_TRADING_ENV=prod`. Today the code only knows
   the demo exchange.
5. Kalshi combo price check: get written data permission from Kalshi first. Then set `KALSHI_DATA_PERMISSION=true`.

## Vercel Hobby note (Nov 19)
While on Vercel Hobby, crons may run at most once a day, so `/api/alerts/run` is set to daily (13:00 UTC) in apps/web/vercel.json. When you upgrade to Vercel Pro (before charging money), set it back to `*/5 * * * *`.
