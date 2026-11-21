# Kismet — instructions for coding agents

Read `docs/README.md` first. It indexes the spec. Build tasks are in `docs/10-tasks.md`.
Every task names the spec section it implements and its acceptance checks.

## What this is
A subscription web app (and later a Chrome extension) for casual bettors placing 1–2 bets, mostly on
their phone (not traders). It shows which prediction-market bets are priced below their true win chance, after fees and after the cost of
crossing the spread. The Python engine (`engine/`, `pipeline/`) already exists and produces
the data. Your job is mostly the product around it: `apps/web` and `apps/extension`.

## Repo layout
```
engine/        Python model, backtest, scanner (exists; do not rewrite)
pipeline/      Python data fetchers (exists)
config/        one JSON per engine instance
output/        JSON the app reads (markets.json, flags.json, model.json, backtest.json, spreads.json)
apps/web/      Next.js app (to build)
apps/extension Chrome MV3 extension (to build, Premium tier)
docs/          the spec
.github/       scheduled refresh workflow
```

## Stack (do not swap without a reason in the PR)
- Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui, TanStack Table + Virtual, Zustand, zod
- Supabase: Auth (Google, email + password, email magic link), Postgres for user data, row-level security on
- Stripe Checkout + Customer Portal + webhooks
- Vercel hosting
- Charts: Recharts

## Rules
1. **Data contract is law.** Types in `apps/web/lib/types.ts` must match `docs/03-data-model.md`.
   If the engine output changes, update both in the same PR.
2. **The browser never downloads `markets.json` whole** (about 20 MB). The server loads it,
   caches it for 120 s, and filters and paginates (`docs/02-architecture.md`).
3. **Every number shown has its basis one tap away** (sample size, model level, backtest record), inside
   "Why this bet?" or a Details expand. Default views stay plain-language: see `docs/OVERHAUL.md`.
4. **No personalized picks.** Flags are the same for everyone. Filters and presets are the user's own.
   Never rank or recommend bets from a user's own positions (`docs/01-product.md`, Compliance).
5. **Disclaimer in the footer of every page and in the extension popup:**
   "Market analytics, not financial advice. Based on past results. 18+."
6. Money values: store cents as integers or numeric; display `$1,234.56`. Users never see cents: payouts as multipliers (`1.47x`), chances and prices as percentages (`68%`), gaps as points (Q, Nov 2026).
7. Dark theme first, emerald accent (`#10b981`), rounded-xl cards, subtle shadows.
8. Tests: Vitest for logic (filters, sizing, serialization), Playwright for the 6 smoke flows in
   `docs/12-test-plan.md`. A task is done only when its acceptance checks pass.
9. Keep PRs small: one task per PR, named `T-xx: title`.
10. Every push to `final` deploys kismetodds.com to production. Push only green work (lint, typecheck, unit, e2e).

## Commands
```bash
# engine (Python 3.12)
pip install -r requirements.txt
python -m engine all          # update + fit + scan  -> output/*.json
python -m engine backtest     # walk-forward test
# web
cd apps/web && pnpm i && pnpm dev
pnpm test && pnpm e2e
```
