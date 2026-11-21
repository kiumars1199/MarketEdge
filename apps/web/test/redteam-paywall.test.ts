// REDTEAM.md regression tests for the Free/anon data paywall (RT-01, RT-03, RT-04, RT-15). Each failed before its fix.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/entitlements";

const h = vi.hoisted(() => ({ tier: "free" as Tier, user: null as null | { id: string; email: string }, jar: new Map<string, string>() }));
vi.mock("@/lib/auth/server", () => ({
  COOKIE_OPTIONS: { httpOnly: true, sameSite: "lax", path: "/" },
  getMe: async () => ({ user: h.user, tier: h.tier, status: null, current_period_end: null, cancel_at_period_end: false }),
  getTier: async () => h.tier,
  supabaseServer: async () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }), insert: async () => ({ error: null }) }),
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (h.jar.has(k) ? { value: h.jar.get(k)! } : undefined),
    set: (k: string, v: string) => void h.jar.set(k, v),
  }),
}));

const abuse = await import("@/lib/abuse");
const { GET: markets } = await import("@/app/api/markets/route");
const { getStore } = await import("@/lib/data/store");
const { band } = await import("@/lib/data/gate");

const req = (p: string, init?: RequestInit) => new Request(`http://test${p}`, init);
const total = async (p: string) => ((await (await markets(req(p))).json()) as { total: number }).total;

beforeEach(() => { abuse.setLimiter(abuse.memoryLimiter()); h.tier = "free"; h.user = null; h.jar.clear(); });

describe("RT-01 signed-out reveals are counted on the server, not in the cookie", () => {
  it("dropping the me_reveals cookie on every request still gets only 3 exact markets a day", async () => {
    const { GET: market } = await import("@/app/api/markets/[id]/route");
    const store = await getStore();
    const ids = store.markets.slice(0, 5).map((m) => m.id);
    const out = [];
    for (const id of ids) {
      h.jar.clear();   // a scraper that never sends the cookie back
      const body = (await (await market(req(`/api/markets/${id}?detail=1`), { params: Promise.resolve({ id }) })).json()) as
        { market: { best: { ranges?: unknown } }; reveals_left: number };
      out.push([body.market.best.ranges ? "banded" : "exact", body.reveals_left]);
    }
    expect(out).toEqual([["exact", 2], ["exact", 1], ["exact", 0], ["banded", 0], ["banded", 0]]);
    h.jar.clear();   // re-opening one already revealed today stays exact
    const again = (await (await market(req(`/api/markets/${ids[0]}?detail=1`), { params: Promise.resolve({ id: ids[0]! }) })).json()) as
      { market: { best: { ranges?: unknown } } };
    expect(again.market.best.ranges).toBeUndefined();
  });
});

describe("RT-03 Free can't enumerate the scan by splitting filters", () => {
  it("signed-out list requests: 30 a minute, then 429 with Retry-After", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await markets(req(`/api/markets?g=0&wp=0&p0=${(i / 100).toFixed(2)}&p1=${((i + 1) / 100).toFixed(2)}`))).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
  });

  it("distinct rows per hour are budgeted: past 1,500 new markets the list answers 429", async () => {
    const r = new Request("http://test/api/markets");
    const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `m${from + i}`);
    for (let i = 0; i < 60; i++) expect(await abuse.rowBudget(r, null, ids(25, i * 25))).toBeNull();   // 1,500 rows
    expect(await abuse.rowBudget(r, null, ids(25, 0))).toBeNull();      // re-listing what you already saw is free
    expect((await abuse.rowBudget(r, null, ids(25, 1_500)))?.status).toBe(429);
    expect(await abuse.rowBudget(r, "someone-else", ids(25, 1_500))).toBeNull();   // per account / IP
  });
});

describe("RT-15 tier-shaped responses are private and vary on Cookie", () => {
  it("markets, flags, market, event, combos, suggest, book, backtest, curve", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ asks: [], bids: [] })));
    const store = await getStore();
    const m = store.markets[0]!;
    const calls: [string, Response | Promise<Response>][] = [
      ["markets", markets(req("/api/markets"))],
      ["flags", (await import("@/app/api/flags/route")).GET(req("/api/flags"))],
      ["market", (await import("@/app/api/markets/[id]/route")).GET(req(`/api/markets/${m.id}`), { params: Promise.resolve({ id: m.id }) })],
      ["event", (await import("@/app/api/events/[id]/route")).GET(req(`/api/events/${m.event_id}`), { params: Promise.resolve({ id: m.event_id }) })],
      ["combos", (await import("@/app/api/combos/route")).GET(req("/api/combos"))],
      ["suggest", (await import("@/app/api/suggest/route")).GET(req("/api/suggest?q=a"))],
      ["book", (await import("@/app/api/book/route")).GET(req("/api/book?token=123&q=0.5"))],
      ["backtest", (await import("@/app/api/backtest/route")).GET()],
      ["curve", (await import("@/app/api/model/curve/route")).GET(req("/api/model/curve"))],
    ];
    for (const [name, p] of calls) {
      const res = await p;
      expect(res.headers.get("cache-control"), name).toMatch(/private/);
      expect(res.headers.get("vary") ?? "", name).toMatch(/Cookie/);
    }
    vi.unstubAllGlobals();
  });
});

describe("RT-04 Free filters and sorts see the banded numbers, not the exact ones", () => {
  it("a return threshold inside one band can't tell markets in that band apart", async () => {
    const store = await getStore();
    const cuts = [0, 5, 10, 20, 50];
    // a market whose exact return sits strictly inside a band, with room for a threshold on each side
    const m = store.markets.find((x) => {
      const [lo, hi] = band(x.best.roi_pct, cuts);
      return lo !== null && hi !== null && x.best.roi_pct - lo > 0.2 && hi - x.best.roi_pct > 0.2;
    })!;
    expect(m, "fixture has a market inside a band").toBeTruthy();
    const [lo] = band(m.best.roi_pct, cuts);
    const below = await total(`/api/markets?g=0&wp=0&roi=${lo! + 0.1}`);
    const above = await total(`/api/markets?g=0&wp=0&roi=${m.best.roi_pct + 0.1}`);
    expect(above).toBe(below);   // exact filtering drops m (and others) between the two thresholds
  });

  it("the win-chance filter works on the 5-point floor Free is shown", async () => {
    const store = await getStore();
    const m = store.markets.find((x) => x.best.win_prob * 20 % 1 > 0.2 && x.best.win_prob * 20 % 1 < 0.8)!;
    const lo = Math.floor(m.best.win_prob * 20) / 20;
    expect(await total(`/api/markets?g=0&wp=${m.best.win_prob + 0.002}`)).toBe(await total(`/api/markets?g=0&wp=${lo + 0.002}`));
  });

  it("with fix-audit1's closed-market filter: Free rows are open markets only, and banded", async () => {
    const store = await getStore();
    const closes = store.markets.map((x) => x.closes_at).sort((a, b) => a - b);
    const now = closes[Math.floor(closes.length / 2)]!;
    vi.stubEnv("DATA_CLOCK", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now * 1000);
    try {
      const body = (await (await markets(req("/api/markets?g=0&wp=0"))).json()) as { rows: { market: { closes_at: number; best: { roi_pct: number } } }[] };
      expect(body.rows.length).toBeGreaterThan(0);
      for (const r of body.rows) {
        expect(r.market.closes_at).toBeGreaterThan(now);
        expect([-1, 0, 5, 10, 20, 50]).toContain(r.market.best.roi_pct);   // Free sees the band floor, never the exact return
      }
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
