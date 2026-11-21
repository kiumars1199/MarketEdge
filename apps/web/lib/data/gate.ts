// Server-side tier shaping (docs/08 LIMITS, docs/15 § Paywall): the client never receives what the tier
// doesn't allow. Free = 10 rows (Best bets: the day's sample, lib/data/respond.ts), page 1 only, estimated return / edge / win chance as ranges, price check
// limited to the first share. Pro and Premium get the data untouched.
import type { MarketsResponse } from "@/lib/api";
import { can, type Tier } from "@/lib/entitlements";
import { rowCap } from "@/lib/settings-core";
import type { CheckResult } from "@/lib/execution";
import type { Execution, Side, SideRanges, StoreMarket, UsQuote } from "@/lib/types";
import type { Store } from "./store";

const ROI = [0, 5, 10, 20, 50];           // % bands: <0, 0–5, 5–10, 10–20, 20–50, 50+
const EDGE = [0, 0.02, 0.05, 0.1, 0.2];   // $ per share: <0¢, 0–2¢, 2–5¢, 5–10¢, 10–20¢, 20¢+

/** [lo, hi] band containing x; null = open end. */
export function band(x: number, cuts: number[]): [number | null, number | null] {
  if (!Number.isFinite(x) || x < cuts[0]) return [null, cuts[0]];
  let i = cuts.length - 1;
  while (x < cuts[i]) i--;
  return [cuts[i], cuts[i + 1] ?? null];
}
/** Number to send in place of the exact value: the band's low end (just under 0 for the negative band). */
const low = ([lo, hi]: [number | null, number | null], neg: number) => lo ?? (hi as number) + neg;
const floor5 = (p: number) => Math.floor(p * 20) / 20;

export function rangeSide(s: Side): Side {
  const r: SideRanges = { roi_pct: band(s.roi_pct, ROI), edge: band(s.edge, EDGE) };
  return {
    ...s,
    roi_pct: low(r.roi_pct, -1),
    edge: low(r.edge, -0.01),
    edge_low: low(band(s.edge_low, EDGE), -0.01),
    win_prob: floor5(s.win_prob),
    win_prob_low: floor5(s.win_prob_low),
    ...(s.realistic_edge != null ? { realistic_edge: low(band(s.realistic_edge, EDGE), -0.01) } : {}),
    ranges: r,
  };
}

/** Free US quote: edge and return as their band's low end; null (listed, no live book) stays null. */
export function usBanded(q: UsQuote): UsQuote {
  return {
    ...q,
    edge: q.edge == null ? null : low(band(q.edge, EDGE), -0.01),
    roi_pct: q.roi_pct == null ? null : low(band(q.roi_pct, ROI), -1),
  };
}

/** Free price check: verdict and the first share only (no stake table, capacity or limit price). */
export function freeExecution<X extends CheckResult>(x: X): X {
  if (!("net_edge" in x)) return x;   // no sellers: nothing to hide
  const { capacity_usd: _c, retention: _r, limit_price: _lp, limit_edge: _le, stakes: _s, ...rest } = x as Execution;
  return {
    ...rest,
    net_edge: low(band(x.net_edge, EDGE), -0.01),
    gross_edge: low(band(x.gross_edge, EDGE), -0.01),
    stakes: [],
  } as Execution as X;
}

export function gateMarket<M extends StoreMarket>(m: M, tier: Tier): M {
  if (can(tier, "exact_edge")) return m;
  const best = rangeSide(m.best);
  return {
    ...m,
    sides: m.sides.map((s) => (s.side_index === m.best.side_index ? best : rangeSide(s))),
    best,
    ...(m.execution ? { execution: freeExecution(m.execution) } : {}),
    // Polymarket US quote: where to bet and its price stay; the US edge and return are banded like the side's
    // (T-302), so Free's "On Polymarket US" set, count and star rating match Pro's (min_edge is a band cut)
    ...(m.us ? { us: usBanded(m.us) } : {}),
  };
}

const freeViews = new WeakMap<Store, Store>();
/** The store as Free sees it (RT-04): list rows and event lists already banded, so filters, sorts and facet counts
 *  run on the ranges Free is shown and can't be used as an oracle for the exact numbers. byId / flagsById stay
 *  exact for a counted reveal (marketBody with shown = "pro"). Built once per loaded store. */
export function freeView(store: Store): Store {
  let v = freeViews.get(store);
  if (!v) {
    const free = (m: StoreMarket) => gateMarket(m, "free");
    const lists = (map: Map<string, StoreMarket[]>) => new Map([...map].map(([k, list]) => [k, list.map(free)]));
    freeViews.set(store, (v = {
      ...store, markets: store.markets.map(free), flags: store.flags.map(free), byEvent: lists(store.byEvent), bySlug: lists(store.bySlug),
    }));
  }
  return v;
}

/** `max`: rows to keep; default the tier's rows per request (Free: site setting free_rows, default 10). The Free Best
 *  bets sample passes its own size (FREE_BEST_BETS_A_DAY), so the setting can't cut or widen the daily allowance. */
export function gateMarkets(r: MarketsResponse, tier: Tier, max = rowCap(tier)): MarketsResponse {
  if (can(tier, "exact_edge")) return r;
  const rows = r.rows.slice(0, max).map(({ market, side }) => {
    const g = gateMarket(market, tier);
    return { market: g, side: g.sides.find((s) => s.side_index === side.side_index) ?? rangeSide(side) };
  });
  const groups = r.groups
    ?.filter((g) => g.start < rows.length)
    .map((g) => ({ ...g, count: Math.min(g.count, rows.length - g.start) }));
  return { ...r, page: 1, pages: 1, rows, groups };
}
