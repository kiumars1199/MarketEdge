# Overhaul lane contract (shared by lanes 0, A–F)

Read with `docs/OVERHAUL.md`. Fixed before lanes start so parallel work fits together.

## Ownership (only edit files you own; anything else: say so in your report, don't edit)
| Lane | Owns |
|---|---|
| R (research) | `docs/research/overhaul*.md`, `docs/research/screens/` |
| A landing | `components/landing/*`, landing copy, `e2e/overhaul-landing.spec.ts` |
| B cards/filters | `components/market/BetCard.tsx` (+ new `components/market/card/*`), `components/screener/{BestBets,LockedBets,FilterPanel,AppliedPills,DayStrip}.tsx`, `app/bets/*`, `lib/card.ts`, `e2e/overhaul-cards.spec.ts`; may update existing e2e specs that assert old card text |
| C speed | `app/page.tsx`, `middleware.ts`, `next.config.ts`, `lib/data/*`, `engine/` output writers (new files only, additive), `ops/upload.py`, `app/api/revalidate/*`, `test/fixtures/*` (additive), `lib/types.ts` + `docs/03-data-model.md` for new files, `scripts/perf/*`, `app/**/loading.tsx` |
| D iPhone | after A+B merge: layout fixes anywhere, `playwright.config.ts` projects, `e2e/overhaul-iphone.spec.ts` |
| E results | `docs/research/live-vs-backtest.md`, `app/track-record/*`, `components/results/*`, engine filter flag (config + scanner, default off), `scripts/ledger/*` |
| F1 venue | `docs/research/polymarket-us.md`, `components/trade/VenueButton.tsx` internals, `lib/venue*.ts`, pipeline additions for Polymarket US |
| F2–4 ops | `.github/workflows/stale-alarm.yml`, `ops/stale_alarm.*`, `lib/email/*`, `lib/telemetry.ts` (+ funnel), `app/admin/funnel/*`, Stripe webhook email hooks, `supabase/migrations/*` (new files only) |

## Card (lane B builds, lane A imports)
`<BetCard r={ApiRow} />` keeps its prop. Visible outside "Why this bet?", at most 7 text elements:
1. plain title ("Crystal Palace to win") 2. "Bet {side}" 3. "Wins about 7 in 10" 4. "$10 wins $5.60"
5. 1–3 star value rating (aria-label "Value: 2 of 3 stars") 6. closing time 7. `<VenueButton m s />` ("Bet on Polymarket").
Wrap the card in `data-testid="bet-card"`; the expand is a `<details data-testid="why">` or button with `aria-expanded`, label "Why this bet?".
Plain titles and stars come from `lib/card.ts` (`plainTitle(m, s)`, `stars(s)`), unit-tested.

## Banned words
`lib/banned.ts`: `bannedHits(text, {counts})` and `readableText(html)`. Whole words, case-insensitive, visible text +
title + meta/og descriptions; scripts and RSC payload excluded. Landing uses `{counts: true}`.

## Data (lane C)
Engine writes additively: `top.json` (best bets, already sorted, every field the card and "Why this bet?" read, as `ApiRow`-shaped
rows), `counts.json` (every count shown anywhere), `top-<category>.json`. Pages fall back to the current path when the file is missing.
Free-tier gating stays server-side exactly as today.

## Process
- Commit messages `T-3xx: …` (lane numbers below), cite research rules as `(R-n)` once `docs/research/overhaul.md` exists.
  End every commit with the trailer lines given in your brief. No PRs, no pushes; the lead merges your branch.
- Don't change prices, plans, the disclaimer, or CLAUDE.md compliance rules.
- Gates before you report: `pnpm lint && pnpm typecheck && pnpm test` green, plus your own e2e specs with
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_PORT=<yours> pnpm exec playwright test <specs> --workers=1`.
  Don't run the whole e2e suite (4 CPUs shared by 6 lanes); the lead runs it on the merged tree.
- Evidence: write `docs/overhaul-evidence/<lane>/NOTES.md` with commands + output, numbers, screenshot paths. The lead alone edits `docs/OVERHAUL-REPORT.md`.
- No real emails, no writes to live Supabase/Stripe/Vercel/Resend/PostHog. Mock in tests. Migrations live in the repo only.

Lane numbers: R T-294, C T-295, E T-296, F1 T-297, F2 T-298, F3 T-299, F4 T-300, A T-301, B T-302, D T-303.
