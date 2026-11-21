// Typed client for the web API. Browser code imports these; server components should call
// getStore()/apply() directly instead of fetching their own API.
//
// Routes (all GET, JSON; errors are { error } with 404 / 503):
//   /api/meta                      → MetaResponse   scan meta, counts, unfiltered facet counts
//   /api/markets?<FilterState>     → MarketsResponse filtered + sorted page (≤ 200 rows). Query keys are the
//                                    short keys of lib/filters/url.ts; unknown keys are ignored and invalid
//                                    values fall back to the default (never a 400).
//                                    Grouped (default): page_size = event groups per page (max 50); each
//                                    group is cut to GROUP_ROWS (4) rows, `size` is its full count (expand
//                                    with /api/events/[id]). `rows` are the page's groups
//                                    flattened in order; `groups[i]` covers rows[start .. start+count) and
//                                    rows[start] is its best row.
//   /api/flags?<FilterState>       → MarketsResponse same as /api/markets with view=flags forced; tier=best|edge|all
//                                    (default best; a pays filter or pays sort widens best to all, see tierOf)
//   /api/combos                    → CombosResponse  suggested 2- and 3-leg combos (docs/18 §5.2), free tier banded
//   /api/combos/kalshi             → GET { enabled }; POST { legs } → Kalshi combo quote (KALSHI_DATA_PERMISSION)
//   /api/markets/[id][?detail=1]   → MarketResponse  market + its model curve + category backtest record +
//                                    the other markets in its event
//   /api/events/[id]               → EventResponse   all markets of one event (by event_id)
//   /api/events/by-slug/[slug]     → EventResponse   same, by Polymarket event slug; CORS * (Chrome extension)
//   /api/model/curve?segment=&h=   → Curve           segment = "all" | "cat:<category>" | "<niche>" | "<niche>:<market_type>"
//                                                    (MarketResponse.segment gives a market's own), h = horizon hours
//   /api/backtest                  → BacktestResponse backtest.json as is + `chosen` (result for the chosen half-life)
//   /api/suggest?q=&tz=&view=      → SuggestResponse teams/topics/markets for the search dropdown (q ≤ 120 chars, else 400)
//   /api/book?token=&q=&cat=&stake= → BookResponse   live execution check of one side (fetchBook)
import type { Curve } from "@/lib/data/model";
import type { Proof } from "@/lib/proof";
import type { Counts, Facets, Group } from "@/lib/filters/apply";
import type { FilterInput } from "@/lib/filters/state";
import type { Chip } from "@/lib/search/parse";
import type { BacktestFile, BacktestRecord, BacktestResult, Execution, ScanMeta, Side, SideRanges, StoreMarket } from "@/lib/types";

export type { Curve, Facets, StoreMarket };

export interface MetaResponse {
  meta: ScanMeta;
  loaded_at: number;                       // ms, when this server instance loaded the data
  counts: { markets: number; flags: number; events: number };
  facets: { categories: Counts; niches: Counts; market_types: Counts; periods: Counts; frequency: Counts; topics: Counts };
  results?: { graded: number; wins: number; losses: number; avg_pnl: number | null } | null;   // live ledger totals (ledger_summary.json)
  delay_min?: number;                      // the plan's minimum delay in minutes (Free 15, paid 0); `meta` is the scan served, at least that old (RT3-03)
}

// side = the side chosen by FilterState.side; price_at = when the live CLOB price was read (paid flags, lib/reprice.ts)
export interface ApiRow { market: StoreMarket; side: Side; price_at?: number }
export type ApiGroup = Omit<Group, "rows" | "best"> & { start: number; count: number };
export interface MarketsResponse {
  total: number;                           // matching rows
  total_groups?: number;                   // when grouped
  page: number; page_size: number; pages: number;
  rows: ApiRow[];
  groups?: ApiGroup[];
  facets: Facets;                          // counts for the current filter minus that facet
  search?: { chips: Chip[]; relaxed?: string };   // how q was understood; relaxed = "No bets match … Showing …"
  free_daily?: number;                     // Free Best bets only: the page is the day's sample of this many (docs/19 P3)
  scanned_at?: number;                     // the scan these rows come from (unix s); the header shows it (QA-A #46)
}

export interface MarketResponse {
  market: StoreMarket;
  segment: string;                         // model segment of the best side (for /api/model/curve)
  curve: Curve | null;                     // that segment at the market's horizon; null for Free / signed-out (RT3-01)
  backtest: BacktestRecord | null;         // walk-forward record for the market's category
  proof?: Proof;                           // T-290: that record beside the category's live record (lib/proof.ts)
  event_markets: StoreMarket[];            // other markets in the same event
  reveals_left?: number;                   // Free tier with ?detail=1: exact-number reveals left today (3/day)
  price_at?: number;                       // live tiers: when the CLOB price was read (lib/reprice.ts); absent = scan price
}

export interface EventResponse {
  event_id: string; event: string; slug: string;
  markets: StoreMarket[];                  // sorted by best estimated return
  flags: StoreMarket[];                    // flagged markets in the event (with execution)
}

export type BacktestResponse = BacktestFile & {
  chosen: BacktestResult | null;
  proof?: Proof;                           // T-290: the chosen result beside the live record (lib/proof.ts siteProof)
};

export interface SuggestResponse {
  q: string;
  line: string;                            // how q is understood: "Barcelona · Pays ~3x"
  // Free tier: roi numbers hold the band's low end and `ranges` the band (lib/data/gate.ts), as on /api/markets.
  entities: { name: string; count: number; best_roi: number; ranges?: SideRanges }[];   // teams, players, cities (≤ 3)
  topics: { id: string; label: string; count: number }[];          // ≤ 2
  markets: { id: string; question: string; side_index: 0 | 1; outcome: string; pays: number | null; roi_pct: number; ranges?: SideRanges }[];   // ≤ 4
}
/** /api/suggest?q=&tz=&view= — suggestions as you type (docs/13). */
export const fetchSuggest = (q: string, view: "markets" | "flags", init?: RequestInit) =>
  get<SuggestResponse>(`/api/suggest?${new URLSearchParams({ q, view, ...(userTz() ? { tz: userTz()! } : {}) })}`, init);

// The fetch helper and the pending-state constants live in ./api-core (T-295: the header's freshness pill reads
// /api/meta on every page without pulling the filter schemas and zod that this module needs).
import { DELAYED_PENDING, PENDING_PREFIX, delayedPendingLine, fetchMeta, get } from "./api-core";
export { DELAYED_PENDING, PENDING_PREFIX, delayedPendingLine, fetchMeta };

/** The browser's IANA zone, so "today" / "tomorrow" in a search mean the user's day. */
const userTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

// T-295: the filter schemas (zod) load with the first screener fetch, not with every component that imports this
// module (bet cards read fetchMarket and backtestOnce on the landing). Screener pages already hold them.
const qs = async (state: FilterInput) => {
  const [{ FilterState }, { serialize }] = await Promise.all([import("@/lib/filters/state"), import("@/lib/filters/url")]);
  const f = FilterState.parse(state);
  const s = serialize(f.q && !f.tz ? { ...f, tz: userTz() } : f).toString();
  return s ? `?${s}` : "";
};

export const fetchMarkets = async (state: FilterInput = {}, init?: RequestInit) => get<MarketsResponse>(`/api/markets${await qs(state)}`, init);
export const fetchFlags = async (state: FilterInput = {}, init?: RequestInit) => get<MarketsResponse>(`/api/flags${await qs(state)}`, init);
/** `detail` = the details panel is opening (counts toward the Free tier's 3 exact reveals a day). */
export const fetchMarket = (id: string, init?: RequestInit, detail = false) =>
  get<MarketResponse>(`/api/markets/${encodeURIComponent(id)}${detail ? "?detail=1" : ""}`, init);
export const fetchEvent = (id: string, init?: RequestInit) => get<EventResponse>(`/api/events/${encodeURIComponent(id)}`, init);
export const fetchEventBySlug = (slug: string, init?: RequestInit) => get<EventResponse>(`/api/events/by-slug/${encodeURIComponent(slug)}`, init);
export const fetchCurve = (segment: string, h: number, init?: RequestInit) =>
  get<Curve>(`/api/model/curve?${new URLSearchParams({ segment, h: String(h) })}`, init);
const fetchBacktest = (init?: RequestInit) => get<BacktestResponse>("/api/backtest", init);
/** /api/combos — suggested combos, the same for everyone (docs/18 §5.2). */
export const fetchCombos = (init?: RequestInit, pays?: import("@/lib/combos").ComboPays) =>
  get<import("@/lib/data/combos").CombosResponse>(pays ? `/api/combos?pays=${pays}` : "/api/combos", init);
let backtestP: Promise<BacktestResponse> | null = null;
/** backtest.json changes once a day at most: one request per page load, shared by every card. */
export const backtestOnce = () => (backtestP ??= fetchBacktest().catch((e) => ((backtestP = null), Promise.reject(e))));

export type BookResponse = { fetched_at?: number } & (
  | (Execution & { warning?: string })
  | { verdict: "no book" | "no sellers"; book_ok: false }
);
export const fetchBook = (p: { token: string; q: number; cat: string; stake?: number }, init?: RequestInit) =>
  get<BookResponse>(`/api/book?${new URLSearchParams({ token: p.token, q: String(p.q), cat: p.cat, ...(p.stake ? { stake: String(p.stake) } : {}) })}`, init);

/** Group rows back out of a MarketsResponse. */
export const groupRows = (r: MarketsResponse, g: ApiGroup) => r.rows.slice(g.start, g.start + g.count);
