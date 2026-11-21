# 02 · Architecture

```
            ┌──────────────── GitHub Actions (every 2 h) ────────────────┐
Polymarket  │ engine update → (daily) backtest → fit → scan              │
 Gamma/CLOB ├────────────────────────────────────────────────────────────┤
 public API │ publishes output/*.json to branch `live`                    │
            └───────────────────────────┬────────────────────────────────┘
                                        │ raw JSON (GitHub token)
                         ┌──────────────▼───────────────┐
                         │  apps/web  (Next.js, Vercel)  │
                         │  Data layer: loads JSON,      │
                         │  caches 120 s, filters/pages  │
Polymarket CLOB (books) ─┤  /api/book live depth (5 s)   │──► Supabase (auth, user data)
                         │  /api/markets, /api/flags ... │──► Stripe (billing)
                         │  cron: alerts every 5 min     │──► Resend (email), Web Push
                         └──────────────┬───────────────┘
                                        │
                     browser (screener, drawer, dashboards) + Chrome extension
```

## Components
| Component | Tech | Owner of |
|---|---|---|
| Engine | Python 3.12, numpy (`engine/`, `pipeline/`) | Data, model, backtest, scan, execution check |
| Refresh job | `.github/workflows/refresh.yml` | Runs the engine every 2 h, publishes `live` branch |
| Web app | Next.js 15 on Vercel | UI, API routes, alert evaluation, billing hooks |
| User DB | Supabase Postgres + Auth | Profiles, presets, dashboards, watchlist, alerts, journal, subscriptions |
| Billing | Stripe | Checkout, portal, webhooks → `subscriptions` table |
| Email | Resend | Magic links (via Supabase SMTP) and alert emails |
| Push | Web Push (VAPID) | Browser alerts |
| Extension | Chrome MV3 | Premium badges on Polymarket/Kalshi pages |

## Data flow and caching
1. The engine writes `markets.json` (~20 MB), `flags.json`, `model.json`, `backtest.json`, `spreads.json`.
2. The web server fetches them from `https://api.github.com/repos/kiumars1199/kismet/contents/<file>?ref=live`
   (header `Accept: application/vnd.github.raw`, `Authorization: Bearer $GITHUB_DATA_TOKEN`),
   or from local `../../output/` when `DATA_SOURCE=local` (dev).
3. `lib/data/store.ts` keeps one parsed copy in memory per server instance:
   ```ts
   getStore(): Promise<Store>
     if cache && now - cache.loadedAt < 120_000 return cache
     if inflight return inflight            // de-duplicate concurrent loads
     inflight = load()                      // fetch markets+flags+meta, build indexes
     // indexes: byId, byEvent, byNiche, facet counts, search tokens
   ```
4. API routes filter and paginate on the server and return ≤ 200 rows per page.
5. Live order books (execution check) come from `POST https://clob.polymarket.com/books`
   via `/api/book?ids=` (cached 5 s), so the drawer shows the current ask, not the scan-time ask.

### Why not a database for market data?
The scan is regenerated every 2 h and is read-only. An in-memory store is simpler and fast enough
(15k markets). Move to Postgres only if scans run more often than every 10 min or rows exceed ~200k.

## API routes (web)
T-276: signed out, every route below answers 401 JSON except the public list in `apps/web/lib/auth/public-paths.ts`
(`PUBLIC_API`: health, meta, me, auth, Stripe webhook, unsubscribe, cron routes, extension token/telemetry,
`events/by-slug` with its own session-or-token check, MCP). "public" in the table means "any signed-in tier".

| Route | Method | Auth | Returns |
|---|---|---|---|
| `/api/meta` | GET | public | scan time, counts, facets (categories, niches, types with counts) |
| `/api/markets` | GET | public (free tier trimmed) | filtered, sorted, paginated markets (`04-filters.md` params) |
| `/api/markets/[id]` | GET | public (trimmed) | one market + backtest record for its segment; its model curve only for Pro+ or a counted reveal (`curve: null` for Free / signed-out, RT3-01) |
| `/api/flags` | GET | public (trimmed) | flags with the same filter params |
| `/api/events/[id]` | GET | public | all markets in one event |
| `/api/events/by-slug/[slug]` | GET | Premium (extension) | event markets + flags by Polymarket slug |
| `/api/book` | GET `?token=` | Pro+ | live execution check for one token (`07-execution.md`) |
| `/api/model/curve` | GET `?segment=&h=` | public (trimmed), rate-limited | win-prob curve points for charts. Pro+: any segment, exact. Free / signed-out: only `all` and `cat:<category>` (what `/track-record` charts), win chance rounded to 5 pp (the width of Free's band), other segments 403. Exact curve + the public mid = exact win chance (RT3-01) |
| `/api/backtest` | GET | public | `backtest.json` summary |
| `/api/presets` etc. | CRUD | user | see `05-features.md` |
| `/api/alerts/run` | POST | cron secret | evaluates alert rules (Vercel Cron, every 5 min) |
| `/api/stripe/webhook` | POST | Stripe sig | subscription sync |

## Environment variables
```
DATA_SOURCE=supabase|github|local   # supabase: private bucket `scan` → `live` branch → last good copy (docs/14 §4)
GITHUB_DATA_TOKEN=            # fine-grained, read-only contents on kiumars1199/kismet
GITHUB_DATA_REPO=   # owner/name of this GitHub repo
GITHUB_DATA_REF=live
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY= / STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_PREMIUM_MONTHLY= / STRIPE_PRICE_PREMIUM_YEARLY=
RESEND_API_KEY=
VAPID_PUBLIC_KEY= / VAPID_PRIVATE_KEY=
CRON_SECRET=
```

## Refresh cadence
| What | How often | Where |
|---|---|---|
| New resolved markets + prices | 2 h | Action `update` |
| Model refit | 2 h | Action `fit` |
| Walk-forward backtest | daily 06:xx UTC | Action `backtest` |
| Open-market scan + flags + book check | 2 h | Action `scan` |
| Live order book in drawer | on open, refresh every 5 s while open | `/api/book` |
| Alerts | 5 min (against latest scan + live book for matched rules) | Vercel Cron |

Upgrade path when paid users arrive: run `scan` every 15 min on a small VM (Railway/Fly) instead of
Actions, keep `update/fit` hourly. Nothing in the web app changes.
