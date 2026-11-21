// T-44 contract tests: the API shapes data by the caller's plan, server-side (docs/08 LIMITS, docs/15 § Paywall).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketResponse, MarketsResponse } from "@/lib/api";
import type { Tier } from "@/lib/entitlements";

const h = vi.hoisted(() => ({ tier: "free" as Tier, jar: new Map<string, string>() }));
vi.mock("@/lib/auth/server", () => ({
  COOKIE_OPTIONS: { httpOnly: true, sameSite: "lax", path: "/" },
  getMe: async () => ({ user: null, tier: h.tier, status: null, current_period_end: null, cancel_at_period_end: false }),
  getTier: async () => h.tier,
  supabaseServer: async () => { throw new Error("signed-out tests only"); },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (h.jar.has(k) ? { value: h.jar.get(k)! } : undefined),
    set: (k: string, v: string) => void h.jar.set(k, v),
  }),
}));

const { GET: markets } = await import("@/app/api/markets/route");
const { GET: flags } = await import("@/app/api/flags/route");
const { GET: market } = await import("@/app/api/markets/[id]/route");
const { getStore, getStoreFor } = await import("@/lib/data/store");
const { band, freeExecution } = await import("@/lib/data/gate");
const { sideEdge, sideRet } = await import("@/lib/format");

const req = (p: string) => new Request(`http://test${p}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const body = async <T,>(r: Response | Promise<Response>) => (await r).json() as Promise<T>;

beforeEach(() => { h.jar.clear(); });

describe("Free tier", () => {
  beforeEach(() => { h.tier = "free"; });

  it("/api/markets: top 10 rows, page 1 only, ranges instead of exact numbers", async () => {
    const b = await body<MarketsResponse>(markets(req("/api/markets?pg=3&ps=200")));
    expect(b.rows).toHaveLength(10);
    expect(b).toMatchObject({ page: 1, pages: 1 });
    for (const { market: m, side } of b.rows) {
      expect(side.ranges).toBeDefined();
      expect(m.best.ranges).toBeDefined();
      const [lo, hi] = side.ranges!.roi_pct;
      expect(side.roi_pct === lo || (lo === null && side.roi_pct < 0)).toBe(true);   // band low end, not the exact value
      if (hi !== null) expect(hi).toBeGreaterThan(lo ?? -Infinity);
      expect((side.win_prob * 20) % 1).toBeCloseTo(0);                                // floored to 5%
    }
    expect(b.groups!.reduce((n, g) => n + g.count, 0)).toBe(b.rows.length);
  });

  it("/api/flags: 10 Best bets a day, the same on refresh, a new sample per visitor and per UTC day (docs/19 P3)", async () => {
    const ids = async () => (await body<MarketsResponse>(flags(req("/api/flags?ps=200&pg=3")))).rows.map((x) => x.market.id).sort().join();
    const b = await body<MarketsResponse>(flags(req("/api/flags?ps=200&pg=3")));
    expect(b.rows.length).toBeGreaterThan(0);
    expect(b.rows.length).toBeLessThanOrEqual(10);
    expect(b.total).toBeGreaterThan(b.rows.length);   // the real N, for "Unlock all N bets"
    expect(b.groups).toBeUndefined();                  // a game group would carry bets outside the sample
    expect(b).toMatchObject({ page: 1, pages: 1 });
    expect(await ids()).toBe(await ids());
    const { freeSample } = await import("@/lib/data/respond");
    const store = await getStoreFor("free");
    const day = Date.UTC(2026, 10, 19, 12);
    expect([...freeSample(store, "k", day)].sort()).toEqual([...freeSample(store, "k", day + 3600_000)].sort());
    expect([...freeSample(store, "k", day)].sort()).not.toEqual([...freeSample(store, "k", day + 86400_000)].sort());
    expect([...freeSample(store, "k", day)].sort()).not.toEqual([...freeSample(store, "u:other", day)].sort());
    expect(freeSample(store, "k", day).size).toBe(10);
  });

  it("/api/combos: none for Free (Premium only, docs/19 P3)", async () => {
    const { GET: combos } = await import("@/app/api/combos/route");
    expect(await body(combos(req("/api/combos")))).toEqual({ groups: [] });
  });

  it("/api/flags: price check cut to the verdict and first share", async () => {
    const b = await body<MarketsResponse>(flags(req("/api/flags")));
    const x = b.rows.find((r) => r.market.execution)!.market.execution!;
    expect(x.stakes).toEqual([]);
    for (const k of ["capacity_usd", "retention", "limit_price", "limit_edge"]) expect(x).not.toHaveProperty(k);
    expect(x.verdict).toBeTruthy();
  });

  it("details panel: exact numbers for 3 markets a day, ranges after", async () => {
    const ids = (await body<MarketsResponse>(markets(req("/api/markets")))).rows.map((r) => r.market.id);
    const lefts: number[] = [];
    for (const id of ids.slice(0, 3)) {
      const b = await body<MarketResponse>(market(req(`/api/markets/${id}?detail=1`), ctx(id)));
      expect(b.market.best.ranges).toBeUndefined();
      lefts.push(b.reveals_left!);
    }
    expect(lefts).toEqual([2, 1, 0]);
    const again = await body<MarketResponse>(market(req(`/api/markets/${ids[0]}?detail=1`), ctx(ids[0])));
    expect(again.market.best.ranges).toBeUndefined();                // re-opening a revealed one is free
    const fourth = await body<MarketResponse>(market(req(`/api/markets/${ids[3]}?detail=1`), ctx(ids[3])));
    expect(fourth.market.best.ranges).toBeDefined();
    expect(fourth.reveals_left).toBe(0);
    const plain = await body<MarketResponse>(market(req(`/api/markets/${ids[4]}`), ctx(ids[4])));
    expect(plain.market.best.ranges).toBeDefined();                  // no ?detail=1: no reveal spent
  });

  it("is served the scan before the newest while the newest is under 15 minutes old", async () => {
    const real = await getStore();
    const g = globalThis as unknown as { __meStore: { cache?: typeof real; prev?: typeof real } };
    const saved = { ...g.__meStore };
    const fresh = { ...real, meta: { ...real.meta, scanned_at: Math.floor(Date.now() / 1000) - 60 }, loadedAt: Date.now() };
    g.__meStore.cache = fresh;
    g.__meStore.prev = real;
    try {
      expect(await getStoreFor("free")).toBe(real);
      expect(await getStoreFor("pro")).toBe(fresh);
      fresh.meta.scanned_at -= 15 * 60;
      expect(await getStoreFor("free")).toBe(fresh);
    } finally {
      Object.assign(g.__meStore, saved);
      if (!saved.prev) delete g.__meStore.prev;
    }
  });
});

describe.each(["pro", "premium"] as const)("%s tier", (tier) => {
  beforeEach(() => { h.tier = tier; });
  it("gets exact numbers, every page and the full price check", async () => {
    const b = await body<MarketsResponse>(markets(req("/api/markets?pg=2")));
    expect(b.page).toBe(2);
    expect(b.rows.length).toBeGreaterThan(25);
    expect(b.rows.every((r) => r.side.ranges === undefined)).toBe(true);
    const f = await body<MarketsResponse>(flags(req("/api/flags")));
    const x = f.rows.find((r) => r.market.execution)!.market.execution!;
    expect(x.capacity_usd).toEqual(expect.any(Number));
    const id = b.rows[0].market.id;
    const d = await body<MarketResponse>(market(req(`/api/markets/${id}?detail=1`), ctx(id)));
    expect(d.reveals_left).toBeUndefined();
    expect(h.jar.size).toBe(0);
  });
});

describe("gate helpers", () => {
  it("band() picks the containing band, open at both ends", () => {
    expect(band(-3, [0, 5, 10])).toEqual([null, 0]);
    expect(band(0, [0, 5, 10])).toEqual([0, 5]);
    expect(band(7, [0, 5, 10])).toEqual([5, 10]);
    expect(band(99, [0, 5, 10])).toEqual([10, null]);
    expect(band(NaN, [0, 5, 10])).toEqual([null, 0]);
  });
  it("freeExecution leaves 'no sellers' alone", () => {
    const x = { verdict: "no sellers", book_ok: false } as const;
    expect(freeExecution(x)).toBe(x);
  });
  it("formats ranges for display", () => {
    const s = { roi_pct: 5, edge: 0.02 };
    expect(sideRet({ ...s, ranges: { roi_pct: [5, 10], edge: [0.02, 0.05] } })).toBe("+5–10%");
    expect(sideEdge({ ...s, ranges: { roi_pct: [5, 10], edge: [0.02, 0.05] } })).toBe("+2–5 pts");
    expect(sideRet({ ...s, ranges: { roi_pct: [null, 0], edge: [null, 0] } })).toBe("under 0%");
    expect(sideRet({ ...s, ranges: { roi_pct: [50, null], edge: [0.2, null] } })).toBe("over +50%");
    expect(sideEdge({ ...s, ranges: { roi_pct: [50, null], edge: [0.2, null] } })).toBe("over +20 pts");
    expect(sideRet(s)).toBe("+5%");
  });
});
