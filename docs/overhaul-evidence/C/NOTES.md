# Lane C (speed), T-295: evidence

Branch `worktree-agent-a9f07f33999a64c43`, based on `overhaul` (3f92f0a). All numbers are local `next build && next start`
on port 3211 with `DATA_SOURCE=local` and the real-size live data (`markets.json` about 20 MB), a 4-core sandbox shared
with other lanes. Prod numbers are the owner's to take after a deploy with `ops/perf-prod.sh`.

## What changed

1. Precomputed `top.json`, `counts.json` and `top-<category>.json` (`engine/precompute.py`, run by `python -m engine all`).
   `lib/data/top.ts` reads them, and falls back to the full store when they're missing or more than 1 h old. The
   landing, `/pricing`, `/about` and `/track-record` read them instead of parsing `markets.json`. `top-<category>.json`
   has no page consumer yet. Free-delay rotation (`-prev`, `-prev2`)
   is the same as for `markets` and `flags`.
2. Static + ISR signed-out pages: `/`, `/pricing`, `/about`, `/track-record`, `/terms`, `/privacy`, `/refunds`,
   `/disclaimer` and `/contact` are `force-static` with `revalidate = 300`. The signed-in/out split moved into
   `middleware.ts`. Signed-in `/` goes to `/bets`; signed-in `/pricing`, `/about` and `/track-record` are rewritten to
   force-dynamic twins under `/signed-in/*` (a direct request there is a 404). The root layout's `force-dynamic`, which
   forced every page dynamic and caused the `private, no-store` header, is gone.
3. `POST /api/revalidate` checks `REVALIDATE_SECRET`, or else `CRON_SECRET`. `ops/upload.py` calls it after a
   successful publish, then warms each page. Unit-tested in `test/static-routes.test.ts` and `ops/tests/test_ops.py`.
4. JS:
   - Zod and the filter schemas no longer ship with every page: `lib/api-core`, `filters/keys`, `filters/bands` and
     `trade/urls` were split out, and `qs()` imports the schemas on first use.
   - Header search and the alerts bell are `next/dynamic` with `ssr: false`, plus same-size placeholders.
   - The Recharts charts on `/track-record` are `ssr: false` with same-height placeholders.
   - `scripts/perf/landing-js.mjs` (`pnpm check:js`, budget 150 kB gzipped for `/`) now runs in web-ci after the build.
5. CLS: `AccountLink` renders "Log in / Sign up" from the layout's no-session-cookie hint, instead of popping in when
   `/api/me` answers. That pop-in pushed every prerendered page down 16 px, CLS 0.018. It is in prod today and was
   hidden in my "before" build because accounts were off.

## Before / after

**TTFB and headers** (`scripts/perf/ttfb-local.sh`, final sha, accounts-on build). Cold is the first request after a
fresh `next start`; warm is the median of 5.

| route | before cold | before warm | before cache-control | after cold | after warm | after cache-control |
|---|---|---|---|---|---|---|
| / | 2095 ms | 35 ms | private, no-cache, no-store | 738 ms | 9 ms | s-maxage=300, stale-while-revalidate (x-nextjs-cache HIT) |
| /pricing | 1908 | 18 | private, no-store | 692 | 10 | s-maxage=300, swr (HIT) |
| /about | 1856 | 42 | private, no-store | 739 | 8 | s-maxage=300, swr (HIT) |
| /track-record | 1864 | 36 | private, no-store | 1022 | 11 | s-maxage=300, swr (HIT) |
| /terms | 727 | 17 | private, no-store | 740 | 7 | s-maxage=300, swr (HIT) |

After cold time is server boot plus module load. The request serves the prerendered HTML and does no data work. In
prod the edge serves these pages (`x-vercel-cache: HIT`), so prod TTFB should drop from 2.35 s to edge latency. To be
verified with `ops/perf-prod.sh`.

**Regeneration cost: `top.json` versus the full store.** This is what an ISR or on-demand regeneration pays on a cold
instance. `scratchpad topvsfull.sh`, run twice:
- fresh `next start`
- warm the runtime on `/terms`
- `POST /api/revalidate`
- time the blocking re-render

The live test data is 23 h old and `top.json` older than `TOP_MAX_AGE_S` (1 h) is ignored. So this run uses
`DATA_CLOCK=scan`, and **every other "after" number on this page went through the full-store fallback**, not `top.json`.

| | `/` re-render | `/track-record` re-render | landing prices rendered |
|---|---|---|---|
| top.json + counts.json (3.7 MB, 1,364 rows) | 394 / 403 ms | 75 / 58 ms | 24 |
| removed: full store (~20 MB markets.json) | 1549 / 1681 ms | 79 / 119 ms | 24 |

**`/api/revalidate` against a real server** (`REVALIDATE_SECRET` set):
- no bearer: 401
- wrong bearer: 401
- right bearer: 200, all 9 STATIC_PAGES listed
- the next GET of each page is a blocking MISS re-render, then HIT

The `upload.py` warm GET pays that re-render, so visitors don't.

**First-load JS**, gzipped, `landing-js.mjs` (root main files + layout + page entries + scripts in the prerendered HTML):

| route | before | after |
|---|---|---|
| / | 203.7 kB | **144.3 kB** (budget 150: OK) |
| /pricing | 165.3 | 130.8 |
| /about | n/a | 132.0 |
| /track-record | 286.6 | 145.8 |
| /bets | 200.1 | 196.6 |

`next build`'s shared floor went from 137 to 108 kB.

**Lighthouse 12.8.2 mobile** (`scripts/perf/lighthouse.sh`, RUNS=2). Paired runs on the same accounts-off build config
and live data, back to back at low load (18:49 before, 18:52 after; load average 1.4 to 3.4):

| route | before perf | before LCP | before CLS | before TBT | after perf | after LCP | after CLS | after TBT |
|---|---|---|---|---|---|---|---|---|
| /bets | 73 / 71 | 3735 / 3628 | 0 / 0 | 627 / 755 | 85 / 85 | 3182 / 3168 | 0.005 / 0.005 | 356 / 362 |
| / | 79 / 80 | 3140 / 3170 | 0 / 0 | 576 / 518 | 92 / 92 | 2745 / 2740 | 0 / 0 | 237 / 239 |
| /track-record | 69 / 66 | 2750 / 3287 | 0 / 0 | 1750 / 1571 | 73 / 80 | 2631 / 2594 | 0 / 0 | 1198 / 680 |

The signed-out view, on an accounts-on build (`NEXT_PUBLIC_SUPABASE_URL` pointing at a dead host), measured under load
average 8 to 17, so TBT is noisy:
`/` LCP 2302 / 2323 ms, CLS 0; `/pricing` LCP 2454 / 2406, CLS 0; `/track-record` LCP 2362 / 2231, CLS 0.
Before the AccountLink fix the same build showed CLS 0.018 on every page.

**INP** (`scripts/perf/inp.mjs`: 390x844, 4x CPU throttle, 7 clicks), three runs each, same paired session:

| route | before | after |
|---|---|---|
| /bets | 120, 144, 112 ms | 104, 96, 96 ms |
| / | 200, 72, 192 ms | 72, 72, 72 ms |

## Kept or dropped, by the numbers

- **Kept: static + ISR pages.** TTFB, plus a cacheable header instead of `no-store`.
- **Kept: the zod / filter split.** Shared JS 137 to 108 kB; `/` 203.7 to 144.3 kB; `/bets` TBT about 700 to about 360 ms.
- **Kept: lazy charts.** `/track-record` JS 286.6 to 145.8 kB and TBT down in the paired run. Most of its remaining TBT
  is hydration of a long page (framework chunk 8701), not Recharts. Placeholder heights were measured with the chart
  chunk held back: identical section heights at 412 px and 1350 px, CLS 0 at both.
- **Kept: AccountLink hint.** CLS 0.018 to 0 on prerendered pages.
- **Not done: a `/bets` fast path from `top.json`.** Its facets and counts don't match what the screener needs, and
  `/bets` is per-user anyway.
- **Not attempted: goal 3, signed-in navigation.** No `loading.tsx` skeletons, no prefetch changes, no cross-user
  caching of signed-in pages, and no signed-in navigation was timed. Their only gain is the shared-bundle trim above.

## Pitfalls found

- A leftover `next start` from an earlier run held port 3211. The new `next start` failed with EADDRINUSE, and the
  script measured the old build: `private, no-store` on pages that were already static. `ttfb-local.sh` now refuses to
  run when the port is taken.
- A server-rendered `next/dynamic` adds `<link rel=preload as=script>` without the CSP nonce, and `strict-dynamic`
  blocks it. Every signed-in page then showed a console violation (caught by `e2e/headers.spec.ts`). Fixed with
  `ssr: false` and same-size placeholders.
- `/bets` has a pre-existing CLS of 0.05 to 0.08: the BestBets proof tiles (`<dl className="min-h-[28px]">`) fill from
  `/api/backtest` after hydration and grow by about 125 px on a phone. The before build shows the same shifts, so it is
  not from this lane. It belongs to lane B: reserve the height, or pass the backtest down from the server.

## Known limits

- **Freshness after an upload.** `resetTop()` clears only the instance that handled the POST. The warm GET can land on
  another instance:
  - With `top.json`, the small files are re-read after 30 s. Static regenerations are their only readers and happen
    at most every 300 s, so that read is almost always fresh.
  - On the full-store fallback, `getStore()` serves its last copy while it reloads. A warm instance can then re-render
    the previous scan, and that page holds until its 300 s window ends.
  - Worst case is about 5 minutes behind, against about 2 minutes for the old dynamic pages. The banner on static pages
    likewise updates within 300 s.
- **Signed-in visitors on untwinned prerendered pages** (`/terms`, `/privacy`, `/refunds`, `/disclaimer`, `/contact`)
  see "Log in / Sign up" in the header until `/api/me` answers, then their account link. Before, the header was empty
  there.
- **Signed-in routing** (cookie → rewrite → `/signed-in/*` twin) is unit-tested in `test/static-routes.test.ts`. It is
  exercised end to end by the paid e2e specs on `next dev` (see Gates), not on a production build.

## Needs owner sign-off

**Static CSP on prerendered pages.** One HTML file is served to everyone, so a per-request nonce is impossible there.
Those pages get:

```
script-src 'self' 'unsafe-inline' https://js.stripe.com https://va.vercel-scripts.com https://us-assets.i.posthog.com
```

There is no `strict-dynamic`. Every other directive is the same as the nonce policy (`frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'`, no `unsafe-eval`). Dynamic pages keep the nonce + `strict-dynamic` policy.
The pages concerned have no user input and no user data. The PostHog asset host, and whether Sentry or BotID need a
script host, have not been checked against prod.

**New config:**
- `REVALIDATE_SECRET` in Vercel and as a GitHub secret.
- `SITE_URL` or `REVALIDATE_URL` as a GitHub variable, and in the engine container's environment if upload runs there.
- Without them, `upload.py` logs "revalidate skipped" and pages refresh within 300 s anyway.

## Gates

- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm test`: 94 files, 686 tests pass, plus 27 ops tests. One run under load average 17 failed the
  `apply() p95 < 150 ms` timing test; it passes alone.
- `pytest ops/tests engine/tests`: 77 passed.
- E2E, `PW_PORT=3210`: `s1-landing`, `headers` (with the new static-CSP test), `proof` and `s2-filters` give
  13 passed. Also run because search and the bell changed: `search.spec` 7 passed, `alerts.spec` 1 passed.
- Paid e2e (`-c playwright.paid.config.ts`): `s7-upgrade`, `paywall-pages` and `t291-plans` give 7 passed. These
  cover signed-in `/` and `/pricing` through the middleware rewrite, and the signed-out pages.
- web-ci's build step, run with the env stripped as in CI (`env -i`, default `DATA_SOURCE=local` from the committed
  `output/`): `pnpm build && pnpm check:bundle && pnpm check:js` passes at 144.3 kB, and the prerendered landing has
  real cards (24 prices).

## Commands

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-anon DATA_SOURCE=local DATA_DIR=<live> pnpm exec next build
PORT=3211 DATA_SOURCE=local DATA_DIR=<live> bash scripts/perf/ttfb-local.sh / /pricing /about /track-record /terms
node scripts/perf/landing-js.mjs --route /            # and --dir <before .next> for the before numbers
BASE=http://localhost:3211 RUNS=2 bash scripts/perf/lighthouse.sh /bets / /track-record
BASE=http://localhost:3211 node scripts/perf/inp.mjs /bets /
ops/perf-prod.sh https://kismetodds.com                # owner, after a deploy
```

## Signed-in navigation (goal 3, done after the lane merged)
`loading.tsx` skeletons (`components/shell/PageSkeleton.tsx`) on every signed-in route: bets, markets, watchlist,
journal, alerts, settings, account, tools, dashboards, combos, kalshi, status, onboarding, m/[id], signed-in/*.
Next's default `<Link>` prefetch now fetches the skeleton with the link, so a tap paints in one frame.
Measured with `node scripts/perf/nav-timing.cjs http://localhost:3250 5` (prod build, DEMO_MODE, real-size live
data, 390×844, median of 5, after the page's prefetch settles). Raw: `nav-before.json`, `nav-after.json`.

| tap | first feedback before | after | content before | after |
|---|---|---|---|---|
| /bets → /markets | 639 ms | 76 ms | 639 ms | 572 ms |
| /markets → /watchlist | 440 ms | 181 ms | 440 ms | 246 ms |
| /watchlist → /bets | 326 ms | 72 ms | 326 ms | 471 ms |
| /markets → /bets | 326 ms | 140 ms | 326 ms | 355 ms |

Locally the server answers in under 0.7 s, so content time is noise-level either way; the gain is the instant
feedback. On prod, where owners saw ~5 s waits, the skeleton is what changes the feel; content time there depends
on the cold-start fixes above.
