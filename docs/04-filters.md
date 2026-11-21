# 04 · Filters, search, sort, grouping

Goal: everything a trader can filter on Kalshi or Polymarket, plus the filters only Kismet
can offer (edge, win chance, confidence, execution). Sources in `11-research.md`.

## Parity checklist
| Filter / sort | Kalshi | Polymarket | Others | Kismet field / status |
|---|---|---|---|---|
| Category chips, multi-select | ✓ | ✓ | ✓ | `category` + taxonomy tree (§ Topic) |
| Sub-category / league / topic | ✓ (tags per category) | ✓ (sub-pages) | ✓ | `niche`, `tags`, derived (`03` §2) |
| Text search (title, event, ticker) | ✓ | ✓ | ✓ | `q` over question + event + outcome + tags |
| Price range (last / yes bid / no bid) | ✓ | — | ✓ | `price_min/max` on the chosen side's ask; `mid` option |
| Min 24h $ volume | ✓ | sort | ✓ | **needs** `volume_24h` from Gamma `volume24hr` (task T-02) |
| Total volume | — | sort | ✓ | `volume` |
| Liquidity | — | sort | ✓ | `liquidity` |
| Min size at best price (yes/no) | ✓ | — | — | flags only: `execution.capacity_usd`; T-02 adds `ask_size` for all |
| Depth control (TOB, 1¢…20¢) | ✓ | — | — | drawer stake table (`07`) |
| Spread | — | — | ✓ | `spread` (max spread filter) |
| Buying skew (≥60% takers one side) | ✓ | — | — | later (needs trades feed) |
| Expiry: within hour / day / week | ✓ | "ending soon" | ✓ | `closes_within` presets + custom range on `hours_to_close` |
| Live only (in progress) | ✓ | live tab | — | `is_live` (derived) |
| Recurring / frequency (daily, weekly, 15-min) | ✓ (crypto 15 min/hourly) | ✓ | — | tags `recurring`, `daily`, `weekly`, `15M` |
| Newest | — | ✓ | ✓ | **needs** `created_at` (T-02) |
| Competitive (closest to 50/50) | — | ✓ | ✓ | sort by abs(mid−0.5) |
| Status (open / resolved) | ✓ | ✓ | ✓ | open only in the screener; resolved in Track record |
| **Edge after fees** | — | — | some | `best.edge` |
| **Pessimistic edge > 0 (confident)** | — | — | — | `best.edge_low > 0` |
| **ROI %** | — | — | ✓ | `best.roi_pct` |
| **Model win chance** | — | — | — | `best.win_prob` |
| **Validated by backtest** | — | — | — | `validated` |
| **Execution verdict** | — | — | — | flags: `execution.verdict` |
| **Edge kept after spread (retention)** | — | — | — | flags: `execution.retention` |
| **Capacity ($ before edge fades)** | — | — | — | flags: `execution.capacity_usd` |
| **Evidence size** | — | — | — | `best.model_events` min |
| **Market type** (moneyline, spread, total, prop) | — | partial | ✓ | `market_type` + `period` |
| Watchlisted only | ✓ (watchlist) | ✓ | ✓ | user watchlist |
| Favorite topics only | — | — | — | profile `favorite_topics` |
| Hide sports / hide crypto quick toggles | — | ✓ | — | negative category filter |

## FilterState (one object drives URL, presets, alerts, API)
```ts
export const FilterState = z.object({
  v: z.literal(1),
  q: z.string().max(120).optional(),
  view: z.enum(["markets", "flags"]).default("markets"),
  categories: z.array(Category).optional(),          // include
  exclude_categories: z.array(Category).optional(),  // "hide sports"
  topics: z.array(z.string()).optional(),            // taxonomy ids, OR within, AND with categories
  market_types: z.array(MarketType).optional(),
  periods: z.array(z.enum(["full","1H","2H","1Q","2Q","3Q","4Q"])).optional(),
  side: z.enum(["best","yes","no","favorite","underdog"]).default("best"),
  price_min: z.number().min(0).max(1).optional(), price_max: z.number().min(0).max(1).optional(),
  win_prob_min: z.number().optional(),
  edge_min: z.number().optional(),                   // e.g. 0.02
  edge_low_positive: z.boolean().optional(),         // confident only
  roi_min: z.number().optional(),
  validated_only: z.boolean().optional(),
  verdicts: z.array(Verdict).optional(),             // flags view
  retention_min: z.number().optional(), capacity_min_usd: z.number().optional(),
  min_events: z.number().int().optional(),           // evidence size
  closes_within_h: z.number().optional(), closes_after_h: z.number().optional(),
  live_only: z.boolean().optional(),
  frequency: z.array(z.enum(["recurring","15M","hourly","daily","weekly"])).optional(),
  volume_min: z.number().optional(), volume_24h_min: z.number().optional(),
  liquidity_min: z.number().optional(), spread_max: z.number().optional(),
  watchlisted_only: z.boolean().optional(), favorites_only: z.boolean().optional(),
  group_by_event: z.boolean().default(true),
  sort: z.object({ key: SortKey, dir: z.enum(["asc","desc"]) })
        .default({ key: "roi", dir: "desc" }),       // shown as "Best expected return"
  win_prob_floor_default: z.number().default(0.4),     // default view hides < 40% chance (long shots)
  page: z.number().int().default(1), page_size: z.number().int().max(200).default(50),
});
type SortKey = "edge" | "edge_low" | "realistic_edge" | "roi" | "win_prob" | "price" | "closes"
  | "volume" | "volume_24h" | "liquidity" | "spread" | "capacity" | "retention"
  | "evidence" | "competitive" | "newest";
```

### URL encoding
Short keys, omitted when default, arrays comma-joined; parse with the zod schema, ignore unknown keys.
`/markets?c=sports&t=sports.nfl,sports.cfb&mt=spreads,totals&e=0.03&conf=1&cw=24&s=edge.desc`
Key map in `lib/filters/url.ts`: `q, view, c, xc, t, mt, per, side, p0, p1, wp, e, conf, roi, val,
vd, ret, cap, ev, cw, ca, live, fq, vol, v24, liq, sp, wl, fav, g, s, pg, ps`.
Round-trip test: `parse(serialize(x)) == x` for 200 random states (Vitest property test).

### Server filtering (pseudocode, `lib/filters/apply.ts`)
```ts
function apply(store: Store, f: FilterState, user?: UserCtx): Page {
  let rows = f.view === "flags" ? store.flags : store.markets
  rows = rows.filter(m =>
    inSet(m.category, f.categories) && !inSet(m.category, f.exclude_categories) &&
    (!f.topics || f.topics.some(id => TAXONOMY[id].match(m))) &&
    inSet(m.market_type, f.market_types) && inSet(m.derived.period, f.periods) &&
    (!f.frequency || f.frequency.some(fr => m.derived.frequency.includes(fr))) &&
    (!f.live_only || m.derived.is_live) &&
    between(m.hours_to_close, f.closes_after_h, f.closes_within_h) &&
    gte(m.volume, f.volume_min) && gte(m.volume_24h, f.volume_24h_min) &&
    gte(m.liquidity, f.liquidity_min) && lte(m.spread, f.spread_max) &&
    (!f.validated_only || m.validated) &&
    (!f.watchlisted_only || user?.watchlist.has(m.id)) &&
    (!f.favorites_only || user?.favoriteTopics.some(id => TAXONOMY[id].match(m))) &&
    (!f.q || store.search.matches(m.id, f.q)))
  // side-level filters run on the side chosen by f.side
  rows = rows.flatMap(m => { const s = pickSide(m, f.side); return s && sideOk(s, f) ? [{m, s}] : [] })
  if (f.view === "flags") rows = rows.filter(r => verdictOk(r.m.execution, f))
  rows.sort(comparator(f.sort))                       // stable; ties by closes_at asc
  const facets = countFacets(rows)                    // categories, topics, types, verdicts
  if (f.group_by_event) return paginate(groupByEvent(rows), f)   // group keeps best row first
  return paginate(rows, f)
}
pickSide(m, side): best → m.best; yes → sides[0]; no → sides[1];
                   favorite → side with higher mid; underdog → lower mid
sideOk(s, f): between(s.ask, p0, p1) && gte(s.win_prob, wp) && gte(s.edge, e)
              && (!conf || s.edge_low > 0) && gte(s.roi_pct, roi) && gte(s.model_events, ev)
```
Free tier: after filtering, `page_size` is capped at 25, `edge` values are rounded to bands
("2–5¢", "5–10¢", "10¢+"), and rows of markets closing in the next 15 min are hidden (delay).

### Search (`lib/data/search.ts`)
Build at load: lowercase tokens from question, event, outcomes, tags, niche (remove punctuation;
keep team names). Query → tokens → AND match with prefix matching; rank by token hits in question
first. Also accept a Polymarket URL or slug pasted in: match `slug`. Target < 20 ms for 15k rows.

### Grouping by event
One game or one weather day creates many correlated markets. Default view groups rows by `event_id`:
the group header shows event title, close time, number of flagged markets, best edge; expanding shows
member rows. Sorting sorts groups by their best member. Toggle `g=0` for flat rows.

### Facets
`/api/meta` and every `/api/markets` response include counts for the current filter minus that
facet (standard faceted search), so chips show "NFL (214)". Zero-count options stay visible but greyed.

### Quick filter chips (top of screener)
`Flags only` · `Confident` · `Validated` · `Closes < 24h` · `Live` · `Weather` · `NFL` · `Soccer` ·
`Crypto` · `Hide sports` · plus the user's favorite topics. Each chip = a FilterState patch.

## Presets
A preset is a named FilterState + sort + visible columns (`03` §3 `presets`). Built-in presets ship
read-only (can be duplicated):
| Preset | Patch |
|---|---|
| Best bets right now (default) | `view=flags, vd=worth it, wp=0.4, s=roi.desc` |
| Most likely to win | `view=flags, wp=0.8, s=win_prob.desc` |
| Weather tomorrow | `t=weather, cw=36, conf=1` |
| NFL favorites, 1–3 days out | `t=sports.nfl, side=favorite, ca=24, cw=96, e=0.02` |
| Soccer pre-game | `t=sports.soccer, cw=48, conf=1` |
| Cheap longshots to avoid | `side=underdog, p1=0.25, s=edge.asc` (education) |
| Closing in 6 hours | `cw=6, conf=1` |
| Big capacity | `view=flags, cap=1000` |
| Crypto daily | `c=crypto, fq=daily` |
