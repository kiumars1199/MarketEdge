# Overnight run: take Kismet from demo to final product

You are the lead agent. Work unattended until everything below is done. Never stop to ask; when something
is unclear, pick the option that best fits the docs, write it in `STATUS.md` → "Decisions", and keep going.
Re-read this file after every auto-compact.

## 0. Ground rules
- Read first: `CLAUDE.md`, `docs/README.md`, then every doc this file names before you touch its area.
- Branch from `demo`. Work on `final` (one commit per task, message `T-xx: title`). Open one PR `final → main` at the end.
- Use agent teams: one sub-agent per lane below, run lanes in parallel where they don't share files.
  Fable is the advisor: ask it before any architecture, security or legal-wording decision.
- UI work uses the **Impeccable** skill and the approved "Chosen" design (`docs/06-ui.md`, `docs/design/`).
  Display language from `docs/06`: percentages, "Pays Nx", plain words. "Worth it" never as a badge.
- Do not rewrite `engine/` or `pipeline/`. Fix a bug there only with a failing test first.
- Never commit secrets. Every key goes in `.env.example` (empty) and `SETUP.md`.
- Never delete or skip a test to make it pass. Never weaken a security control to make something work.
- Product rules that can't be broken: no personalized picks from a user's own bets/positions; no auto-trading;
  footer disclaimer "Market analytics, not financial advice. Based on past results. 18+." on every page and the
  extension popup; no "pick / lock / guaranteed / sure thing / can't lose" anywhere.
- Owner details not known yet (operator names, support email, state, refund choice, domain, address) come from
  `config/site.json`. Leave clear placeholders like `[[SUPPORT_EMAIL]]`; never invent them.
- Done means it works for a real stranger on the internet, not just on localhost. This is the version we
  test for a while and then sell.

## 1. Build lanes (all of them, in this order of priority)

**Lane A: engine: more history, two tiers, multipliers, combo backtest** (`docs/18-multipliers-and-combos.md` §1–2, §5.4).
Start this first; it runs for hours. Backfill to 730 days (resumable), 52 weekly folds, `by_pays` breakdown,
`tier` on every flag, combo backtest. Update docs/03 and `lib/types.ts` together. pytest green.

**Lane C: multipliers, clean numbers, combos in the app** (`docs/18` §3–5). Pays pill on both tiers, "Biggest payout"
sort, 2x+/5x+/10x+ chips, "More bets with an edge" section, `formatCount` everywhere, combo builder tray,
suggested combos, Kalshi combo check behind the data-permission flag, combo orders in paper mode.

**Lane S: search and Best bets home** (`docs/13-search-and-filters-v2.md`, T-70..T-75), skipping anything already on `demo`.
Smart search ("barcelona 3x good edge"), suggestions while typing, five simple pills, `/` = Best bets, landing at `/about`.

**Lane U: UI polish** (`docs/17-ui-polish.md`, every numbered fix plus "worth keeping open all day").
Then a full pass on every page: spacing, alignment, borders, empty/loading/error states, 390 px mobile, keyboard focus,
no layout shift. Screenshot every page at 390 and 1440 into `docs/screenshots/final/`.

**Lane L: accounts, billing, legal** (`docs/14-launch.md` §1–3, §6, `docs/08-auth-billing.md`).
Supabase Auth (Google + magic link), 18+ and Terms checkbox, onboarding, `/account` (export, delete, sign out everywhere),
local→account import, 3-session limit. Stripe Checkout **and** Payment Links placeholders, webhook (verified, idempotent),
portal, 7-day trial, entitlements enforced on the server. Pricing buttons show "Coming soon" when keys are empty.
Legal pages `/terms /privacy /refunds /disclaimer /contact` generated from `config/site.json`, with the trading terms
section shown only when trading is enabled. SEO: metadata, OG images, sitemap, robots, 404/500.

**Lane K: Kalshi trading, paper only** (`docs/16-trading.md` §3–4 exactly).
Keys live only in the extension (non-extractable WebCrypto; read + `write::trade` only; reject any key with transfer or
full write). Web ↔ extension messaging with one-time server nonces; `externally_connectable` limited to our origin.
Order ticket: limit price, $ or contracts, Kalshi fee estimate, `buy_max_cost`, confirm screen every time,
`client_order_id`; live status, cancel, fills into My bets; per-order and per-day caps; "Paper mode" badge.
Everything points at `external-api.demo.kalshi.co` and only turns on when `KALSHI_TRADING_ENV=demo`; production stays off.
Shared Ed25519 + RSA-PSS signing module with unit tests; e2e against the demo exchange if a test key is in
`.env.local`, otherwise mocked. "Open on Kalshi / Polymarket" link on every bet (this ships on by default).
No auto-trading code paths of any kind.

**Lane E: extension** (`docs/09-extension.md`). Finish it to Chrome Web Store quality: popup, side panel on
Polymarket event pages, sign-in handoff, Premium gate, the Lane K key vault, disclaimer in popup, icons, store
screenshots, a privacy-practices answer sheet in `docs/STORE_LISTING.md`. Build a zip with `pnpm ext:zip`.

**Lane O: ops and hosting** (`docs/14-launch.md` §4–5, `docs/02-architecture.md`).
Engine Dockerfile + Railway/Fly config (scan every 10 min, update+fit hourly, backtest daily) uploading to a private
Supabase Storage bucket; web reads `DATA_SOURCE=supabase` → GitHub `live` → last good copy. Fix and test
`.github/workflows/refresh.yml` and add web CI (lint, typecheck, unit, e2e). `/api/health`, Sentry with PII
scrubbing, PostHog cookieless events (T-64), Resend for magic links and alerts with one-click unsubscribe,
Vercel cron for alerts and settlement with `CRON_SECRET`. Vercel config ready to deploy.

**Lane X: security** (`docs/15-security.md`, every control, including Trading keys).
Server-side paywall and row trimming, rate limits (Upstash), bot defenses (Vercel BotID/Firewall rules,
AI-crawler blocks, no bulk endpoints, signed short-lived data URLs), RLS on every table with tests that prove a user
can't read another user's rows, CSP and security headers, CSRF on mutations, zod on every input,
webhook signature checks, no secrets or PII in logs or client bundles, dependency pinning.

## 2. Owner files to write
- `SETUP.md`: every account to create and every value to paste, in order, with where it goes
  (Supabase, Stripe products/prices or 4 Payment Links, Vercel, domain + DNS, Resend SPF/DKIM/DMARC, Upstash,
  Railway/Fly, Sentry, PostHog, Chrome Web Store), plus how to create a Kalshi demo account and a trade-only
  demo API key, plus how to deploy and how to roll back.
- `STATUS.md`: what works, what's behind a flag, what needs an owner value, decisions made, known issues.
- `LAUNCH_TODO.md`: owner-only steps before charging money (fill `config/site.json`, Stripe live mode, Vercel Pro,
  lawyer review of legal pages; and before real-money trading: Kalshi partnership + CFTC/NFA lawyer, `docs/16` §5).

## 3. Final audit: run LAST, after all lanes are merged into `final` and frozen
Do not start this until every lane is finished. Then spawn **a fresh auditor agent that did not build anything**
and give it only this section, the docs and the repo. It runs every check, writes results, and the build agents fix
every fail. Re-run the full audit after the fixes. Repeat until zero fails. Write `AUDIT.md`: each item pass/fail,
how it was checked, evidence (command output, screenshot path, test name).

1. **Tests**: `pytest -q`, `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm test`, `pnpm e2e` (S1–S8 from
   `docs/12-test-plan.md` plus search, trading-paper and account-delete flows). All green on a clean clone with
   `pnpm i --frozen-lockfile`.
2. **Production build**: `pnpm build` with `DEMO_MODE` off and empty keys succeeds; app runs, free tier works,
   paid buttons say "Coming soon", no dev banners, no crashes.
3. **Every page × every state**: logged out / free / pro / premium (seeded users), at 390 and 1440 px, light
   network throttling. No console errors or warnings, no NaN/undefined/null/"[object Object]" on screen, no
   broken links (crawl every internal link), no lorem ipsum, no TODO/FIXME in shipped code, no `console.log`.
4. **Quality**: Lighthouse mobile ≥ 90 performance, accessibility, best practices, SEO on `/`, `/about`,
   `/pricing`; axe zero serious/critical; keyboard-only walkthrough of search → drawer → save → upgrade;
   `prefers-reduced-motion` respected; screenshots reviewed against the Chosen design for alignment, spacing,
   borders, truncation and contrast.
5. **Data correctness**: numbers on cards equal the `/api` responses and `output/*.json`; fees and returns match
   the engine's formulas on 20 sampled bets; freshness pill correct; free tier really is delayed and capped
   in the server response (not hidden in the client).
6. **Security** (`docs/15` checklist, with evidence): try to read paid data as free/anon via the API; try another
   user's rows via Supabase directly with the anon key; replay a Stripe webhook; forge a webhook; hammer endpoints
   to confirm rate limits; fetch as a known AI crawler and a headless bot; check headers with
   `curl -I` (CSP, HSTS, X-Frame-Options/frame-ancestors, Referrer-Policy, Permissions-Policy); `pnpm audit` and
   `pip-audit` with no high/critical; gitleaks (or equivalent) on the full git history; grep client bundles for
   secret names and service keys; cookies HttpOnly/Secure/SameSite.
7. **Multipliers and combos**: a 10x bet with a 14% chance and a 4-point edge appears in tier 2; every count uses `formatCount` and never rounds up (grep for raw counts); combo math matches hand-computed cases; same-event legs warned; suggested combos hidden if the combo backtest lost money.
8. **Trading safety**: trading fully off without `KALSHI_TRADING_ENV`; with `demo`, every order needs a confirm;
   caps enforced; keys never leave the extension (inspect network and storage); keys with transfer scope rejected;
   no code path places an order without a user click (grep + review).
9. **Billing**: Stripe test mode end to end: checkout → webhook → tier up → portal cancel → tier down at period end;
   Payment Link path with `client_reference_id`; idempotency on duplicate events; delete account cancels the subscription.
10. **Legal and wording**: all legal pages present, linked in the footer, filled from config (placeholders listed,
   not failed); disclaimer on every page and in the extension popup; 18+ gate at signup; grep for banned words;
   no claim of guaranteed or expected profit anywhere, including meta tags, OG images and emails; responsible-gambling
   resources on `/disclaimer`; unsubscribe in every email.
11. **Publication readiness**: robots and sitemap correct; no test users, seed data or debug routes reachable in
    prod; error pages styled; favicon and OG images; email templates render; extension zip installs on a clean
    Chrome profile and passes the MV3 checks; `SETUP.md` followed from scratch by the auditor in a fresh clone
    reaches a running app.

When the audit is clean: update `STATUS.md`, open the PR `final → main` with the audit summary, and stop.
