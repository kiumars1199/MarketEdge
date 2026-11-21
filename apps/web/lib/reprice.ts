// Live re-pricing (server only, live tiers only: Free stays 15 min behind). Before a paid user's Best bets page,
// All markets page or market drawer leaves the server, the current CLOB price of each side replaces the scan price.
// The model's win chance is recomputed at the new mid with the engine's own formula (engine/model.py predict, from
// model.json theta/cov/knots), then fee, edge, Pays (1 / ask), verdict and tier, with the engine's rules
// (engine/scan.py is_flag / is_edge). One batched POST /prices per request, cached 15 s per token; on a timeout or
// error the row keeps its scan price (no price_at, so the card shows no "Price as of").
import type { ApiRow, MarketsResponse } from "@/lib/api";
import { feeRate } from "@/lib/execution";
import type { ModelFile, Side, StoreMarket } from "@/lib/types";
import { MIN_EDGE } from "@/lib/book";
import { segmentOf } from "@/lib/data/model";

const CLOB = "https://clob.polymarket.com";
const TTL_MS = 15_000;
const TIMEOUT_MS = 1_500;

/** Engine rule constants not in scan meta: config/demo.json `edge_tier` (test/reprice.test.ts checks they match). */
export const EDGE_TIER = { price_min: 0.03, min_neff: 40 };

export type Quote = { at: number; ask: number; bid: number | null };
export type Quotes = Map<string, Quote>;
/** Where live quotes come from; tests inject one (lib/reprice livePrices is the default). */
export type QuoteSource = (tokens: string[], now?: number) => Promise<Quotes>;

// ponytail: per-instance in-memory cache, unbounded by token count; shared cache if traffic grows
const cache = new Map<string, Quote>();
export const _clearPriceCache = () => cache.clear();

/** Current best ask / bid per token. BUY and SELL are both asked and the higher is taken as the ask, so the result
 *  doesn't depend on which side Polymarket labels which. Missing tokens = no live price. */
export const livePrices: QuoteSource = async (tokens, now = Date.now()) => {
  const out: Quotes = new Map();
  const need: string[] = [];
  for (const t of new Set(tokens.filter(Boolean))) {
    const hit = cache.get(t);
    if (hit && now - hit.at < TTL_MS) out.set(t, hit);
    else need.push(t);
  }
  if (!need.length) return out;
  try {
    const res = await fetch(`${CLOB}/prices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(need.flatMap((token_id) => [{ token_id, side: "BUY" }, { token_id, side: "SELL" }])),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, { BUY?: string | number; SELL?: string | number }>;
    for (const t of need) {
      const px = [Number(data?.[t]?.BUY), Number(data?.[t]?.SELL)].filter((x) => Number.isFinite(x) && x > 0 && x < 1);
      if (!px.length) continue;
      const q = { at: now, ask: Math.max(...px), bid: px.length > 1 ? Math.min(...px) : null };
      cache.set(t, q);
      out.set(t, q);
    }
  } catch {
    // timeout or CLOB error: these rows keep the scan price
  }
  return out;
};

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** What re-pricing needs from the store: the model (win chance at a new price) and the engine's rule. */
export interface RepriceCtx {
  model?: ModelFile;
  priceRange: [number, number];    // meta.rule.price_range (tier best)
  z: number;                       // meta.rule.confidence_z
  minEdge: number;                 // meta.rule.min_edge
}

export function ctxOf(store: { model?: ModelFile; meta?: { rule?: { min_edge?: number; confidence_z?: number; price_range?: number[] } } }): RepriceCtx {
  const rule = store.meta?.rule;
  const pr = rule?.price_range;
  return {
    model: store.model,
    priceRange: pr && pr.length === 2 ? [pr[0]!, pr[1]!] : [0.05, 0.95],
    z: rule?.confidence_z ?? 1.28,
    minEdge: rule?.min_edge ?? MIN_EDGE,
  };
}

// engine/model.py basis() + predict(): logit features with hinge knots, sigmoid(Xθ), lower bound at z standard errors.
type FitNode = { theta?: number[]; cov?: number[][]; level: string; key: string; market_type: string; horizon_h: number };
const LEVEL = { nmt: "niche+type", niche: "niche", cat: "category", all: "all" } as const;

export function predictAt(ctx: RepriceCtx, m: Pick<StoreMarket, "niche" | "market_type" | "category" | "horizon_h">, s: Side, p: number): { q: number; lo: number } | null {
  const model = ctx.model as (ModelFile & { knots?: number[] }) | undefined;
  const knots = model?.knots;
  if (!model || !knots) return null;
  const seg = segmentOf(m as StoreMarket, s);
  const [a, b] = seg.split(":");
  const level = LEVEL[s.model_level as keyof typeof LEVEL] ?? "all";
  const key = level === "all" ? "all" : level === "category" ? b : a;
  const mt = level === "niche+type" ? b : "all";
  const node = (model.nodes as FitNode[]).find((n) => n.level === level && n.key === key && n.market_type === mt && n.horizon_h === m.horizon_h);
  if (!node?.theta || !node.cov) return null;
  const pc = Math.min(0.99, Math.max(0.01, p));
  const x = Math.log(pc / (1 - pc));
  const X = [1, x, ...knots.map((k) => Math.max(0, x - k))];
  const eta = X.reduce((acc, xi, i) => acc + xi * node.theta![i]!, 0);
  let v = 0;
  for (let i = 0; i < X.length; i++) for (let j = 0; j < X.length; j++) v += X[i]! * node.cov[i]![j]! * X[j]!;
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  return { q: sig(eta), lo: sig(eta - ctx.z * Math.sqrt(Math.max(0, v))) };
}

/** The side at a live quote, same formulas as the engine (engine/scan.py, lib/execution.ts check()). The side's own
 *  token book gives its mid; without a bid the scan's ask-to-mid gap is kept. */
export function sideAt(s: Side, q: Pick<Quote, "ask" | "bid">, m: Pick<StoreMarket, "category" | "niche" | "market_type" | "horizon_h">, ctx?: RepriceCtx): Side {
  const ask = q.ask;
  const mid = q.bid !== null ? (ask + q.bid) / 2 : s.mid + (ask - s.ask);
  const pred = ctx ? predictAt(ctx, m, s, mid) : null;
  const win = pred ? pred.q : s.win_prob;
  const low = pred ? pred.lo : s.win_prob_low;
  const fee = feeRate(m.category) * ask * (1 - ask);
  const edge = win - ask - fee;
  return {
    ...s, ask: r4(ask), mid: r4(mid), fee: r4(fee), win_prob: r4(win), win_prob_low: r4(low),
    edge: r4(edge), edge_low: r4(low - ask - fee),
    roi_pct: Math.round((edge / (ask + fee)) * 1e4) / 100,
    realistic_edge: s.realistic_edge == null ? s.realistic_edge : r4(Math.min(s.realistic_edge, edge)),
  };
}

/** The tier a re-priced best side still earns (engine is_flag / is_edge); tiers only drop, never rise (validation
 *  and the live-book check aren't re-run). null = no longer a bet. */
export function tierAt(was: StoreMarket["tier"], s: Side, ctx: RepriceCtx): "best" | "edge" | null {
  if (!was) return null;
  const [lo, hi] = ctx.priceRange;
  const off50 = Math.abs(s.mid - 0.5) >= 0.005;
  if (!off50 || s.mid >= hi || s.edge < ctx.minEdge) return null;
  if (was === "best" && s.mid >= lo && s.edge_low > 0) return "best";
  if (s.mid >= EDGE_TIER.price_min && s.model_neff >= EDGE_TIER.min_neff) return "edge";
  return null;
}

/** A market at live prices: every side with a quote is re-priced; `best` stays the same side. A flagged market whose
 *  best side lost its edge (or left the engine's price range) loses its tier and price check. */
export function repriceMarket(m: StoreMarket, quotes: Quotes, ctx: RepriceCtx): { market: StoreMarket; at?: number } {
  let at: number | undefined;
  const sides = m.sides.map((s) => {
    const q = quotes.get(m.tokens?.[s.side_index] ?? "");
    if (!q) return s;
    at = at === undefined ? q.at : Math.min(at, q.at);
    return sideAt(s, q, m, ctx);
  });
  if (at === undefined) return { market: m };
  const best = sides.find((s) => s.side_index === m.best.side_index) ?? m.best;
  const bq = quotes.get(m.tokens?.[best.side_index] ?? "");
  // a flag row without `tier` predates tiers and counts as best (same as freeSample / the filters)
  const tier = bq ? tierAt(m.tier ?? (m.execution ? "best" : undefined), best, ctx) : m.tier;
  const ex = m.execution;
  let execution = ex;
  if (ex && bq) {
    const mid = bq.bid !== null ? (bq.ask + bq.bid) / 2 : best.mid;
    const gross = best.win_prob - mid;
    const retention = gross > 0 ? best.edge / gross : 0;
    execution = {
      ...ex, best_ask: best.ask, best_bid: bq.bid, book_mid: r4(mid), spread: r4(bq.ask - (bq.bid ?? bq.ask)),
      fee_at_ask: best.fee, net_edge: best.edge, gross_edge: r4(gross),
      ...(ex.retention !== undefined ? { retention: r4(retention) } : {}),
      verdict: best.edge >= ctx.minEdge && retention >= 0.5 ? ("worth it" as const) : ("thin" as const),
    };
  }
  const { tier: _t, execution: _e, ...rest } = m;
  const market: StoreMarket = tier ? { ...rest, tier, sides, best, ...(execution ? { execution } : {}) } : { ...rest, sides, best };
  return { market, at };
}

/** One row at its live price. `drop` (Best bets): null when the bet lost its edge or its tier is no longer listed. */
export function repriceRow(r: ApiRow, quotes: Quotes, ctx: RepriceCtx, keepTier?: (t: "best" | "edge") => boolean): ApiRow | null {
  const { market, at } = repriceMarket(r.market, quotes, ctx);
  if (at === undefined) return r;
  if (keepTier && (!market.tier || !keepTier(market.tier))) return null;
  const side = market.sides.find((s) => s.side_index === r.side.side_index) ?? r.side;
  return { market, side, price_at: at };
}

const tokensOf = (rows: ApiRow[]) => rows.flatMap((r) => r.market.tokens ?? []);

/** A list page at live prices. Best bets (`keepTier` set) drops rows that lost their edge and shrinks groups to
 *  match; All markets keeps every row. `total` drops by this page's losses (the rest of the list isn't priced). */
export async function repricePage(page: MarketsResponse, ctx: RepriceCtx, keepTier?: (t: "best" | "edge") => boolean, source: QuoteSource = livePrices, now = Date.now()): Promise<MarketsResponse> {
  if (!page.rows.length) return page;
  const quotes = await source(tokensOf(page.rows), now);
  if (!quotes.size) return page;
  const next = page.rows.map((r) => repriceRow(r, quotes, ctx, keepTier));
  const rows = next.filter((r): r is ApiRow => r !== null);
  const dropped = page.rows.length - rows.length;
  if (!dropped) return { ...page, rows };
  const groups = page.groups?.map((g) => {
    const before = next.slice(0, g.start).filter(Boolean).length;
    return { ...g, start: before, count: next.slice(g.start, g.start + g.count).filter(Boolean).length };
  }).filter((g) => g.count > 0);
  const total_groups = page.total_groups !== undefined && groups && page.groups
    ? Math.max(0, page.total_groups - (page.groups.length - groups.length)) : page.total_groups;
  return { ...page, rows, total: Math.max(0, page.total - dropped), ...(groups ? { groups, total_groups } : {}) };
}

/** Several markets (the drawer's market and its event siblings) at live prices, in one batched call. */
export async function repriceMarkets(ms: StoreMarket[], ctx: RepriceCtx, source: QuoteSource = livePrices, now = Date.now()): Promise<{ markets: StoreMarket[]; at?: number }> {
  if (!ms.length) return { markets: ms };
  const quotes = await source(ms.flatMap((m) => m.tokens ?? []), now);
  if (!quotes.size) return { markets: ms };
  let at: number | undefined;
  const markets = ms.map((m) => {
    const r = repriceMarket(m, quotes, ctx);
    if (r.at !== undefined) at = at === undefined ? r.at : Math.min(at, r.at);
    return r.market;
  });
  return { markets, at };
}
