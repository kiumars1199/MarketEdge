// Live re-pricing (lib/reprice.ts): batched /prices, 15 s cache, timeout falls back to the scan price,
// edge / Pays / tier recomputed, bets that lost their edge dropped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiRow, MarketsResponse } from "@/lib/api";
import { readFileSync } from "node:fs";
import { EDGE_TIER, _clearPriceCache, livePrices, predictAt, repricePage, repriceRow, type RepriceCtx } from "@/lib/reprice";
import { priceAsOf } from "@/lib/format";
import type { FlagsFile, ModelFile, Side, StoreMarket } from "@/lib/types";

const CTX: RepriceCtx = { priceRange: [0.05, 0.95], z: 1.28, minEdge: 0.02 };   // no model: win chance kept

const side = (i: 0 | 1, ask: number, win_prob: number): Side => ({
  side_index: i, outcome: i ? "No" : "Yes", ask, mid: ask, fee: 0, win_prob, win_prob_low: win_prob - 0.03,
  edge: win_prob - ask, edge_low: win_prob - 0.03 - ask, roi_pct: 0, model_level: "cat", model_neff: 500, model_events: 100,
  realistic_edge: 0.05,
});
const row = (id: string, ask: number, win_prob: number, tier: "best" | "edge" = "best"): ApiRow => {
  const s = side(0, ask, win_prob);
  const market = {
    id, question: id, tier, tokens: [`t-${id}`, `n-${id}`], category: "sports", sides: [s, side(1, 1 - ask, 1 - win_prob)], best: s,
    execution: { book_ok: true, best_bid: ask - 0.01, best_ask: ask, book_mid: ask, spread: 0.01, spread_cost: 0, fee_at_ask: 0,
      gross_edge: 0.1, net_edge: 0.1, retention: 0.9, stakes: [], verdict: "worth it" },
  } as unknown as StoreMarket;
  return { market, side: s };
};
const page = (rows: ApiRow[]): MarketsResponse =>
  ({ total: 40, page: 1, page_size: 20, pages: 2, rows, facets: {} } as unknown as MarketsResponse);

function stubPrices(prices: Record<string, { BUY: string; SELL: string }>) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(prices));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => _clearPriceCache());
afterEach(() => vi.unstubAllGlobals());

describe("live re-pricing", () => {
  it("asks /prices once per request for every token on the page, and caches 15 s", async () => {
    const fn = stubPrices({ "t-a": { BUY: "0.40", SELL: "0.41" }, "t-b": { BUY: "0.30", SELL: "0.31" } });
    const q = await livePrices(["t-a", "t-b", "t-a"], 1_000_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]![0]).toBe("https://clob.polymarket.com/prices");
    expect(JSON.parse(fn.mock.calls[0]![1]!.body as string)).toHaveLength(4);   // BUY + SELL per token
    expect(q.get("t-a")).toEqual({ at: 1_000_000, ask: 0.41, bid: 0.4 });
    await livePrices(["t-a", "t-b"], 1_014_000);   // still fresh
    expect(fn).toHaveBeenCalledTimes(1);
    await livePrices(["t-a"], 1_016_000);          // 16 s later: asked again
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("falls back to the scan price when the CLOB times out or errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));
    const p = page([row("a", 0.4, 0.55)]);
    expect(await repricePage(p, CTX)).toBe(p);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await repricePage(p, CTX)).toBe(p);
  });

  it("recomputes edge, fee, Pays, verdict and keeps the row with a timestamp", () => {
    const r = repriceRow(row("a", 0.4, 0.55), new Map([["t-a", { at: 5, ask: 0.45, bid: 0.44 }]]), CTX)!;
    expect(r.side.ask).toBe(0.45);
    expect(r.side.fee).toBeCloseTo(0.0124, 4);   // sports 5% fee: 0.05 * 0.45 * 0.55
    expect(r.side.edge).toBeCloseTo(0.55 - 0.45 - 0.012375, 4);
    expect(r.side.roi_pct).toBeCloseTo((0.087625 / 0.462375) * 100, 1);
    expect(r.market.best.ask).toBe(0.45);   // Pays = 1 / ask
    expect(r.market.execution!.net_edge).toBe(r.side.edge);
    expect(r.market.execution!.verdict).toBe("worth it");
    expect(r.side.realistic_edge).toBeLessThanOrEqual(r.side.edge);
    expect(r.price_at).toBe(5);
  });

  it("drops a bet that lost its edge and moves a best bet with no pessimistic edge to the edge tier", async () => {
    stubPrices({
      "t-gone": { BUY: "0.54", SELL: "0.55" },    // ask 55c on a 55% chance: no edge left
      "t-weak": { BUY: "0.50", SELL: "0.51" },    // edge ~2.75c but win_prob_low - ask - fee < 0
      "t-keep": { BUY: "0.30", SELL: "0.31" },
    });
    const out = await repricePage(page([row("gone", 0.4, 0.55), row("weak", 0.4, 0.55), row("keep", 0.3, 0.5), row("nolive", 0.3, 0.5)]), CTX, () => true);
    expect(out.rows.map((r) => r.market.id)).toEqual(["weak", "keep", "nolive"]);
    expect(out.total).toBe(39);
    expect(out.rows[0]!.market.tier).toBe("edge");
    expect(out.rows[1]!.market.tier).toBe("best");
    expect(out.rows[2]!.price_at).toBeUndefined();   // no live quote: scan price, no "Price as of"
  });

  it("shrinks event groups to the rows left", async () => {
    stubPrices({ "t-a": { BUY: "0.54", SELL: "0.55" }, "t-b": { BUY: "0.30", SELL: "0.31" }, "t-c": { BUY: "0.30", SELL: "0.31" } });
    const p = { ...page([row("a", 0.4, 0.55), row("b", 0.3, 0.5), row("c", 0.3, 0.5)]), total_groups: 5,
      groups: [{ start: 0, count: 1 }, { start: 1, count: 2 }] } as unknown as MarketsResponse;
    const out = await repricePage(p, CTX, () => true);
    expect(out.groups).toEqual([{ start: 0, count: 2 }]);
    expect(out.total_groups).toBe(4);
  });

  it("updates the side's mid from its own token's book", () => {
    const r = repriceRow(row("a", 0.4, 0.55), new Map([["t-a", { at: 5, ask: 0.45, bid: 0.43 }]]), CTX)!;
    expect(r.side.mid).toBe(0.44);
  });

  it("drops a bet whose price leaves the engine's range, and lets a cheap best bet fall to the edge tier", () => {
    const at = (ask: number, bid: number) => new Map([["t-a", { at: 5, ask, bid }]]);
    const any = () => true;
    // mid 0.955 >= price_max 0.95: out of range for both tiers, even with a big edge
    expect(repriceRow(row("a", 0.9, 0.995), at(0.96, 0.95), CTX, any)).toBeNull();
    // mid 0.04: below best's 5c floor, above the edge tier's 3c floor -> edge
    expect(repriceRow(row("a", 0.06, 0.2), at(0.045, 0.035), CTX, any)!.market.tier).toBe("edge");
    // mid 0.02: below every floor
    expect(repriceRow(row("a", 0.06, 0.2), at(0.025, 0.015), CTX, any)).toBeNull();
    // mid within half a cent of 50c: the engine never flags it
    expect(repriceRow(row("a", 0.4, 0.6), at(0.503, 0.501), CTX, any)).toBeNull();
    // Best bets (tier=best) drops a bet that fell to the edge tier
    expect(repriceRow(row("a", 0.06, 0.2), at(0.045, 0.035), CTX, (t) => t === "best")).toBeNull();
  });

  it("All markets keeps a row that lost its edge, without its flag", () => {
    const r = repriceRow(row("a", 0.4, 0.55), new Map([["t-a", { at: 5, ask: 0.56, bid: 0.55 }]]), CTX)!;
    expect(r).not.toBeNull();
    expect(r.market.tier).toBeUndefined();
    expect(r.market.execution).toBeUndefined();
    expect(r.side.ask).toBe(0.56);
  });

  it("the edge tier's rule matches config/demo.json", () => {
    const cfg = JSON.parse(readFileSync(new URL("../../../config/demo.json", import.meta.url), "utf8"));
    expect(EDGE_TIER).toEqual({ price_min: cfg.edge_tier.price_min, min_neff: cfg.edge_tier.min_neff });
  });

  it("recomputes the win chance with the engine's formula (matches the scan at the scan's own mid)", () => {
    const model = JSON.parse(readFileSync(new URL("../../../output/model.json", import.meta.url), "utf8")) as ModelFile;
    const flags = JSON.parse(readFileSync(new URL("../../../output/flags.json", import.meta.url), "utf8")) as FlagsFile;
    const ctx = { ...CTX, model, z: flags.meta.rule.confidence_z };
    const sample = flags.flags.filter((_, i) => i % 97 === 0);
    expect(sample.length).toBeGreaterThan(20);
    for (const m of sample) {
      for (const s of m.sides) {
        const p = predictAt(ctx, m as unknown as StoreMarket, s, s.mid)!;
        expect(p, m.id).not.toBeNull();
        expect(Math.abs(p.q - s.win_prob), m.id).toBeLessThan(2e-4);
        expect(Math.abs(p.lo - s.win_prob_low), m.id).toBeLessThan(2e-4);
      }
    }
  });

  it("reads 'Price as of Xs ago'", () => {
    expect(priceAsOf(100_000, 112_000)).toBe("Price as of 12s ago");
    expect(priceAsOf(0, 5 * 60_000)).toBe("Price as of 5 min ago");
  });
});
