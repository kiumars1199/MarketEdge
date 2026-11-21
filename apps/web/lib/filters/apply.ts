// Server-side filtering, sorting, grouping and facets (docs/04 § Server filtering).
// Missing fields (volume_24h, created_at, competitive, ...) count as "no value": a min/max filter on them
// excludes the row and sorting puts them last in either direction. Values are never invented.
import type { Store } from "@/lib/data/store";
import { parse, toFilterState, type Chip, type ParsedQuery } from "@/lib/search/parse";
import { TAXONOMY, topicsOf } from "@/lib/taxonomy";
import type { Execution, Side, StoreMarket } from "@/lib/types";
import { tierOf, type FilterState, type SortKey } from "./state";
import { PAYS_BANDS, band, paysBand } from "./bands";
export { PAYS_BANDS, paysBand };   // T-295: moved to ./bands (light, for the bet cards)
import { onUs, usActive, usRoi } from "./us";
import { betQuote } from "@/lib/betFigures";

export const GROUP_ROWS = 4;
export interface UserCtx { watchlist: Set<string>; favoriteTopics: string[] }
export interface Row { market: StoreMarket; side: Side }
export interface Group {
  event_id: string; event: string; slug: string;
  closes_at: number;        // earliest close among member rows
  flagged: number;          // member rows that are flags
  size: number;             // matching rows in the group (rows below are cut to GROUP_ROWS)
  best: Row;                // first row = best by the current sort
  rows: Row[];
}
export type Counts = Record<string, number>;
export interface Facets {
  categories: Counts; topics: Counts; market_types: Counts; periods: Counts; verdicts: Counts;
  // Simple-filter pills (docs/13 §2), each counted with every filter but its own:
  pays: Counts;             // PAYS_BANDS keys + "any"
  chance: Counts;           // CHANCE_BANDS keys + "any" (the 40% floor is part of the chance filter)
  roi: Counts;              // rows with return >= 5 / 10 / 20 % + "any"
  closes_h: number[];       // rows by whole hours to close: [i] = ceil(hours) == i (0..168), [169] = later
}

/** docs/13 §2 chance choices: [key, label, min, max]. */
export const CHANCE_BANDS: [string, string, number, number][] = [
  ["likely", "Likely (80%+)", 0.8, 1], ["leans", "Leans your way (55–80%)", 0.55, 0.8],
  ["coin", "Coin flip (40–55%)", 0.4, 0.55], ["long", "Long shot (under 40%)", 0, 0.4],
];
/** backtest.json by_pays key for a side: ask 0.10 → "10x+". */
export interface Page {
  total: number;            // matching rows
  total_groups?: number;    // matching event groups (when grouped)
  page: number; page_size: number;
  pages: number;            // page count for this filter
  // Flat: rows[(page-1)*page_size ...]. Grouped: page_size = event groups per page (max 50), each cut to
  // GROUP_ROWS rows (Group.size is the full count), so a page holds <= 200 rows.
  rows: Row[];              // rows on this page (grouped: the page's groups flattened, best first)
  groups?: Group[];
  facets: Facets;           // counts for the current filter minus that facet
  search?: { chips: Chip[]; relaxed?: string };   // how q was understood; relaxed = honest fallback note (docs/13)
  parsed?: ParsedQuery;     // server only (marketsPage strips it)
}

/** Request-time clock (unix s) for the closed-market filter. DATA_CLOCK=scan (unit and e2e runs on the fixtures)
 *  pins it to the scan time, so fixture markets don't close as the calendar moves on. */
export const nowFor = (store: Pick<Store, "meta">): number =>
  process.env.DATA_CLOCK === "scan" ? store.meta.scanned_at : Date.now() / 1000;
/** Markets still open at `now`: one whose closes_at has passed is never listed or offered as a bet. */
export const openOnly = <T extends { closes_at: number }>(list: T[], now: number): T[] => list.filter((m) => m.closes_at > now);

interface SearchPlan { f: FilterState; hits: Map<string, number> | null; parsed: ParsedQuery | null; relevance: boolean }

/**
 * q → filters + text hits (docs/13). A pasted URL/slug matches its event. Otherwise q is parsed; filter words merge
 * into FilterState (explicit filters win) and the leftover text goes to the index. With text and the default sort,
 * rows rank by relevance; a typed sort word ("soonest") or a chosen sort wins.
 */
function planSearch(store: Store, f: FilterState, parsed?: ParsedQuery): SearchPlan {
  const q = f.q ?? "";
  const direct = parsed ? null : store.search.slug(q);
  if (direct) return { f, hits: direct, parsed: null, relevance: false };
  const p = parsed ?? parse(q, { cities: store.search.cities, tz: f.tz, now: Date.now() });
  const hits = p.text.length ? store.search.find(p.text.join(" ")) : null;
  const defaultSort = f.sort.key === "roi" && f.sort.dir === "desc";
  return { f: toFilterState(p, f, store.meta.scanned_at * 1000), hits, parsed: p, relevance: !!hits && !p.sort && defaultSort };
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const gte = (x: number | null | undefined, min?: number) => min === undefined || (num(x) && x >= min);
const lte = (x: number | null | undefined, max?: number) => max === undefined || (num(x) && x <= max);
const below = (x: number | null | undefined, max?: number) => max === undefined || (num(x) && x < max);   // pays bands are [min, max)
const inSet = <T>(x: T, set?: readonly T[]) => !set || set.includes(x);

export function pickSide(m: StoreMarket, side: FilterState["side"]): Side | undefined {
  const [a, b] = m.sides;
  switch (side) {
    case "best": return m.best;
    case "yes": return a;
    case "no": return b;
    case "favorite": return a && b ? (b.mid > a.mid ? b : a) : a;
    case "underdog": return a && b ? (b.mid < a.mid ? b : a.mid < b.mid ? a : b) : a;
  }
}

/** Payout multiplier per $1 staked, before fee (docs/13): 1 / ask. */
export const paysOf = (s: Pick<Side, "ask">) => (s.ask > 0 ? 1 / s.ask : null);

/** QA-A #69: what "Biggest payout" sorts by: what $1 really returns after the fee, 1 / (ask + fee), the same after-fee
 *  multiplier the cards show (lib/betQuote.ts `pays`, lane B; repoint here once it lands). */
export const sortPays = (s: Pick<Side, "ask" | "fee">) => (s.ask > 0 ? 1 / (s.ask + (s.fee ?? 0)) : null);

/** Asking for long shots (pays >= 2x, price <= 40¢, chance <= 40%) lifts the default 40% floor (docs/13 § Matching). */
export const liftsFloor = (f: FilterState) =>
  (f.pays_min ?? 0) >= 2 || (f.price_max ?? 1) <= 0.4 || (f.win_prob_max ?? 1) <= 0.4;

/** Side-level filters; the 40% win-chance floor applies unless win_prob_min is set (wp=0 turns it off) or lifted. */
export function sideOk(s: Side, f: FilterState): boolean {
  const pays = paysOf(s);
  return gte(s.ask, f.price_min) && lte(s.ask, f.price_max) &&
    gte(pays, f.pays_min) && below(pays, f.pays_max) &&
    gte(s.win_prob, f.win_prob_min ?? (liftsFloor(f) ? 0 : f.win_prob_floor_default)) && lte(s.win_prob, f.win_prob_max) &&
    gte(s.edge, f.edge_min) && (!f.edge_low_positive || s.edge_low > 0) &&
    gte(s.roi_pct, f.roi_min) && gte(s.model_events, f.min_events);
}

function executionOk(x: Execution | undefined, f: FilterState): boolean {
  if (!f.verdicts && f.retention_min === undefined && f.capacity_min_usd === undefined) return true;
  return !!x && inSet(x.verdict, f.verdicts) && gte(x.retention, f.retention_min) && gte(x.capacity_usd, f.capacity_min_usd);
}

const SORT_VALUE: Record<SortKey, (r: Row) => number | null | undefined> = {
  edge: (r) => r.side.edge,
  edge_low: (r) => r.side.edge_low,
  realistic_edge: (r) => r.side.realistic_edge,
  roi: (r) => r.side.roi_pct,
  win_prob: (r) => r.side.win_prob,
  price: (r) => r.side.ask,
  closes: (r) => r.market.closes_at,
  volume: (r) => r.market.volume,
  volume_24h: (r) => r.market.volume_24h,
  liquidity: (r) => r.market.liquidity,
  spread: (r) => r.market.spread,
  capacity: (r) => r.market.execution?.capacity_usd,
  retention: (r) => r.market.execution?.retention,
  evidence: (r) => r.side.model_events,
  competitive: (r) => r.market.competitive,
  newest: (r) => r.market.created_at,
  pays: (r) => betQuote(r.market, r.side).pays,   // QA-A #69: the after-fee payout the card shows (US price on a US card)
};

/** Missing values last in either direction; ties by closes_at asc, then id. `us`: the "On Polymarket US" filter is on,
 *  so "Best estimated return" ranks by the US return (docs/OVERHAUL.md §G2). */
export function comparator(sort: FilterState["sort"], us = false): (a: Row, b: Row) => number {
  const get = us && sort.key === "roi" ? (r: Row) => usRoi(r.market, r.side.roi_pct) : SORT_VALUE[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return (a, b) => {
    const x = get(a), y = get(b);
    const hx = num(x), hy = num(y);
    if (hx !== hy) return hx ? -1 : 1;
    if (hx && hy && x !== y) return (x - y) * sign;
    return a.market.closes_at - b.market.closes_at || (a.market.id < b.market.id ? -1 : a.market.id > b.market.id ? 1 : 0);
  };
}

function groupByEvent(rows: Row[], flagIds?: Map<string, unknown>): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const m = r.market;
    let g = groups.get(m.event_id);
    if (!g) groups.set(m.event_id, (g = { event_id: m.event_id, event: m.event, slug: m.slug, closes_at: m.closes_at, flagged: 0, size: 0, best: r, rows: [] }));
    g.rows.push(r);
    g.size++;
    g.closes_at = Math.min(g.closes_at, m.closes_at);
    if (m.execution && (!flagIds || flagIds.has(m.id))) g.flagged++;
  }
  return [...groups.values()];
}

// Facet bits: a row counts toward facet X when every filter except X passes.
const CAT = 1, TOPIC = 2, MT = 4, PER = 8, VD = 16, PAYS = 32, CHANCE = 64, ROI = 128, CLOSES = 256, TIER = 512;

export function apply(store: Store, f0: FilterState, user?: UserCtx, parsed?: ParsedQuery): Page {
  const plan = f0.q ? planSearch(store, f0, parsed) : null;
  const f = plan?.f ?? f0;
  const hits = plan?.hits ?? null;
  const source = f.view === "flags" ? store.flags : store.markets;
  // Tier is a facet bit, not a source filter: Pays band counts include both tiers, because picking a band
  // searches both (tierOf). Markets view ignores tier.
  const tier = f.view === "flags" ? tierOf(f) : "all";
  const fav = f.favorites_only ? (user?.favoriteTopics ?? []) : null;
  const fNoVerdicts = { ...f, verdicts: undefined }; // verdicts are a facet (VD bit)
  const us = usActive(store.meta, f);                // "On Polymarket US": a plain filter, not a facet
  const minEdge = store.meta.rule.min_edge;

  const facets: Facets = {
    categories: Object.fromEntries(["sports", "crypto", "politics", "finance", "culture", "weather", "tech", "geopolitics", "other"].map((k) => [k, 0])),
    topics: Object.fromEntries(Object.keys(TAXONOMY).map((k) => [k, 0])),
    market_types: Object.fromEntries(["moneyline", "spreads", "totals", "props", "yes/no", "multi-outcome"].map((k) => [k, 0])),
    periods: Object.fromEntries(["full", "1H", "2H", "1Q", "2Q", "3Q", "4Q"].map((k) => [k, 0])),
    verdicts: Object.fromEntries(["worth it", "thin", "not worth it", "no sellers", "no book"].map((k) => [k, 0])),
    pays: { any: 0, ...Object.fromEntries(PAYS_BANDS.map(([k]) => [k, 0])) },
    chance: { any: 0, ...Object.fromEntries(CHANCE_BANDS.map(([k]) => [k, 0])) },
    roi: { any: 0, "5": 0, "10": 0, "20": 0 },
    closes_h: new Array(170).fill(0),
  };
  // pays / chance / return / closes are facets: checked as mask bits, not inside sideOk
  const fSide: FilterState = { ...f, pays_min: undefined, pays_max: undefined, win_prob_min: 0, win_prob_max: undefined, roi_min: undefined };
  const floor = f.win_prob_min ?? (liftsFloor(f) ? 0 : f.win_prob_floor_default);
  const anyFloor = liftsFloor({ ...f, win_prob_min: undefined, win_prob_max: undefined }) ? 0 : f.win_prob_floor_default;   // chance "Any"
  const bump = (c: Counts, k: string) => (c[k] = (c[k] ?? 0) + 1);

  const rows: Row[] = [];
  const now = nowFor(store);
  for (const m of source) {
    if (m.closes_at <= now) continue;   // closed since the scan: not a bet any more, counts nowhere
    let mask = 0;
    if (!inSet(m.category, f.categories)) mask |= CAT;
    const topics = topicsOf(m);
    if (f.topics && !f.topics.some((id) => topics.has(id))) mask |= TOPIC;
    if (!inSet(m.market_type, f.market_types)) mask |= MT;
    if (!inSet(m.derived.period, f.periods)) mask |= PER;
    if (f.verdicts && !(m.execution && f.verdicts.includes(m.execution.verdict))) mask |= VD;
    if (tier !== "all" && (m.tier ?? "best") !== tier) mask |= TIER;

    const s = pickSide(m, f.side);
    if (!s) continue;
    const pays = paysOf(s);
    if (!gte(pays, f.pays_min) || !below(pays, f.pays_max)) mask |= PAYS;
    if (!gte(s.win_prob, floor) || !lte(s.win_prob, f.win_prob_max)) mask |= CHANCE;
    if (!gte(s.roi_pct, f.roi_min)) mask |= ROI;
    if (!gte(m.hours_to_close, f.closes_after_h) || !lte(m.hours_to_close, f.closes_within_h)) mask |= CLOSES;
    const other =
      !sideOk(s, fSide) ||
      (f.exclude_categories?.includes(m.category) ?? false) ||
      (f.frequency ? !f.frequency.some((fr) => m.derived.frequency.includes(fr)) : false) ||
      (f.live_only && !m.derived.is_live) ||
      !gte(m.volume, f.volume_min) || !gte(m.volume_24h, f.volume_24h_min) ||
      !gte(m.liquidity, f.liquidity_min) || !lte(m.spread, f.spread_max) ||
      (f.validated_only && !m.validated) ||
      (f.watchlisted_only && !user?.watchlist.has(m.id)) ||
      (fav && !fav.some((id) => topics.has(id))) ||
      (hits && !hits.has(m.id)) ||
      (us && !onUs(m, minEdge)) ||
      !executionOk(m.execution, fNoVerdicts);
    if (other) continue;   // fails a non-facet filter: counts nowhere

    if (!(mask & ~CAT)) bump(facets.categories, m.category);
    if (!(mask & ~TOPIC)) for (const id of topics) bump(facets.topics, id);
    if (!(mask & ~MT)) bump(facets.market_types, m.market_type);
    if (!(mask & ~PER)) bump(facets.periods, m.derived.period);
    if (!(mask & ~VD) && m.execution) bump(facets.verdicts, m.execution.verdict);
    // Picking a 2x+ band lifts the long-shot floor, so those bands are counted the way they would show.
    if (!(mask & ~(PAYS | CHANCE | (f.tier === "best" ? TIER : 0))) && pays !== null) {
      const b = band(PAYS_BANDS, pays);
      const lifted = gte(s.win_prob, f.win_prob_min ?? 0) && lte(s.win_prob, f.win_prob_max);
      if (!(mask & (CHANCE | TIER))) facets.pays.any!++;
      if (b && (PAYS_BANDS.find(([k]) => k === b)![2] >= 2 ? lifted : !(mask & CHANCE))) facets.pays[b]!++;
    }
    if (!(mask & ~CHANCE)) {
      if (gte(s.win_prob, anyFloor)) facets.chance.any!++;
      // chance filters are inclusive at both ends (win_prob_max uses <=), so a boundary row counts in both bands
      for (const [k, , lo, hi] of CHANCE_BANDS) if (s.win_prob >= lo && s.win_prob <= hi) facets.chance[k]!++;
    }
    if (!(mask & ~ROI)) for (const k of ["any", "5", "10", "20"]) if (k === "any" || s.roi_pct >= +k) facets.roi[k]!++;
    if (!(mask & ~CLOSES)) facets.closes_h[Math.min(169, Math.max(0, Math.ceil(m.hours_to_close)))]!++;
    if (mask === 0) rows.push({ market: m, side: s });
  }

  const cmp = comparator(f.sort, us);
  if (plan?.relevance && hits) {
    // text score × (1 + 0.5 × estimated return, 0–50% scaled to 0–1) + 10% if it closes within 24 h
    const score = new Map(rows.map((r) => {
      const s = hits.get(r.market.id) ?? 0;
      return [r, s * (1 + 0.5 * Math.min(1, Math.max(0, r.side.roi_pct / 50))) + (r.market.hours_to_close <= 24 ? 0.1 * s : 0)];
    }));
    rows.sort((a, b) => score.get(b)! - score.get(a)! || cmp(a, b));
  } else rows.sort(cmp);
  const base = {
    total: rows.length, page: f.page, page_size: f.page_size, facets,
    ...(plan?.parsed ? { parsed: plan.parsed, search: { chips: plan.parsed.chips } } : {}),
  };
  if (!f.group_by_event) {
    const start = (f.page - 1) * f.page_size;
    return { ...base, pages: Math.ceil(rows.length / f.page_size), rows: rows.slice(start, start + f.page_size) };
  }

  // Page over event groups. Each group carries its best row plus up to GROUP_ROWS-1 more (size = full count;
  // expand via /api/events/[id]). Groups per page = page_size, capped so a page never exceeds 200 rows.
  const all = groupByEvent(rows, store.flagsById);
  const per = Math.min(f.page_size, Math.floor(200 / GROUP_ROWS));
  const groups = all.slice((f.page - 1) * per, f.page * per).map((g) => (g.size > GROUP_ROWS ? { ...g, rows: g.rows.slice(0, GROUP_ROWS) } : g));
  return { ...base, page_size: per, pages: Math.ceil(all.length / per), total_groups: all.length, groups, rows: groups.flatMap((g) => g.rows) };
}
