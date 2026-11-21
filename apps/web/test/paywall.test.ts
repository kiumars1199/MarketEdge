// docs/15 § Paywall contract tests (Lane X): every data route, per tier (anon / free / pro / premium).
// Free and anon must never receive exact returns, the full price check, model internals or more than 10 rows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/entitlements";

const h = vi.hoisted(() => ({ tier: "free" as Tier, user: null as null | { id: string; email: string }, jar: new Map<string, string>() }));
vi.mock("@/lib/auth/server", () => ({
  COOKIE_OPTIONS: { httpOnly: true, sameSite: "lax", path: "/" },
  getMe: async () => ({ user: h.user, tier: h.tier, status: null, current_period_end: null, cancel_at_period_end: false }),
  getTier: async () => h.tier,
  // T-276: the route-level gates are checked as if accounts were off (no signed-out teaser), so anon still sees the data path
  authEnabled: () => false,
  getUser: async () => h.user,
  supabaseServer: async () => ({
    // signed-in Free user's reveal rows (drawer_reveals): none yet, inserts succeed
    from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }), insert: async () => ({ error: null }) }),
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (h.jar.has(k) ? { value: h.jar.get(k)! } : undefined),
    set: (k: string, v: string) => void h.jar.set(k, v),
  }),
}));

const routes = {
  markets: (await import("@/app/api/markets/route")).GET,
  flags: (await import("@/app/api/flags/route")).GET,
  market: (await import("@/app/api/markets/[id]/route")).GET,
  event: (await import("@/app/api/events/[id]/route")).GET,
  slug: (await import("@/app/api/events/by-slug/[slug]/route")).GET,
  suggest: (await import("@/app/api/suggest/route")).GET,
  book: (await import("@/app/api/book/route")).GET,
  meta: (await import("@/app/api/meta/route")).GET,
  backtest: (await import("@/app/api/backtest/route")).GET,
  curve: (await import("@/app/api/model/curve/route")).GET,
  combos: (await import("@/app/api/combos/route")).GET,
};
const { getStore } = await import("@/lib/data/store");
const { eventBody, marketBody } = await import("@/lib/data/respond");

const req = (p: string) => new Request(`http://test${p}`);
const ctx = <K extends string>(k: K, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<K, string>) });
const json = async (r: Response | Promise<Response>) => {
  const res = await r;
  return { status: res.status, body: (await res.json()) as unknown };
};

const PAID_ONLY = ["capacity_usd", "retention", "limit_price", "limit_edge"];
const INTERNALS = ["theta", "cov", "knots"];

/** Walks a response body: every Side-like object (has side_index + roi_pct) and every price check. */
function audit(body: unknown) {
  const sides: Record<string, unknown>[] = [], checks: Record<string, unknown>[] = [], keys = new Set<string>();
  let maxList = 0;   // longest list of market rows
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    for (const k of ["rows", "markets", "flags", "event_markets"]) if (Array.isArray(o[k])) maxList = Math.max(maxList, (o[k] as unknown[]).length);
    Object.keys(o).forEach((k) => keys.add(k));
    if ("side_index" in o && "roi_pct" in o && "win_prob" in o) sides.push(o);
    if ("net_edge" in o && "verdict" in o) checks.push(o);
    Object.values(o).forEach(walk);
  };
  walk(body);
  return { sides, checks, keys, maxList };
}

function expectFreeShape(body: unknown) {
  const a = audit(body);
  for (const s of a.sides) expect(s.ranges, `side ${String(s.outcome)} carries exact numbers`).toBeDefined();
  for (const x of a.checks) {
    for (const k of PAID_ONLY) expect(x).not.toHaveProperty(k);
    expect(x.stakes).toEqual([]);
  }
  for (const k of INTERNALS) expect(a.keys.has(k)).toBe(false);
  return a;
}

function expectPaidShape(body: unknown) {
  const a = audit(body);
  for (const s of a.sides) expect(s.ranges).toBeUndefined();
  for (const k of INTERNALS) expect(a.keys.has(k)).toBe(false);
  return a;
}

let sample: { id: string; event_id: string; slug: string; token: string; word: string };
beforeEach(async () => {
  h.jar.clear();
  const s = await getStore();
  const f = s.flags[0]!;
  sample = { id: f.id, event_id: f.event_id, slug: f.slug, token: f.tokens[0], word: f.question.split(/\W+/)[0]! };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([{
    asset_id: sample.token, bids: [{ price: "0.40", size: "5000" }], asks: [{ price: "0.42", size: "5000" }],
  }])));
});
afterEach(() => vi.unstubAllGlobals());

/** Every data route once, as the current tier. */
async function everyRoute() {
  return {
    markets: await json(routes.markets(req("/api/markets?ps=200&pg=1"))),
    flags: await json(routes.flags(req("/api/flags?ps=200"))),
    flagsEdge: await json(routes.flags(req("/api/flags?ps=200&tier=edge"))),   // docs/18 lower-confidence tier
    flagsAll: await json(routes.flags(req("/api/flags?ps=200&tier=all"))),
    combos: await json(routes.combos(req("/api/combos"))),
    market: await json(routes.market(req(`/api/markets/${sample.id}`), ctx("id", sample.id))),
    event: await json(routes.event(req(`/api/events/${sample.event_id}`), ctx("id", sample.event_id))),
    slug: await json(routes.slug(req(`/api/events/by-slug/${sample.slug}`), ctx("slug", sample.slug))),
    suggest: await json(routes.suggest(req(`/api/suggest?q=${encodeURIComponent(sample.word)}`))),
    book: await json(routes.book(req(`/api/book?token=${sample.token}&q=0.6&cat=sports`))),
    meta: await json(routes.meta()),
    backtest: await json(routes.backtest()),
    curve: await json(routes.curve(req("/api/model/curve?segment=all&h=24"))),
  };
}

describe.each([
  ["anon", null],
  ["free (signed in)", { id: "u-free", email: "f@x.test" }],
] as const)("%s", (_name, user) => {
  beforeEach(() => { h.tier = "free"; h.user = user; });

  it("every data route: bands only, verdict-only price check, no internals, ≤ 10 rows", async () => {
    const all = await everyRoute();
    for (const [route, { status, body }] of Object.entries(all)) {
      expect(status, route).toBe(200);
      const a = expectFreeShape(body);
      expect(a.maxList, route).toBeLessThanOrEqual(route === "curve" || route === "backtest" ? Infinity : 10);
    }
    const s = all.suggest.body as { markets: { ranges?: unknown }[]; entities: { ranges?: unknown }[] };
    expect(s.markets.length).toBeGreaterThan(0);
    for (const r of [...s.markets, ...s.entities]) expect(r.ranges).toBeDefined();   // suggest rows carry bands, not exact returns
  });

  it("tier=edge rows are banded and capped like the rest", async () => {
    const { body } = await json(routes.flags(req("/api/flags?ps=200&tier=edge")));
    const rows = (body as { rows: { tier?: string }[] }).rows;
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows.every((r) => r.tier === "edge")).toBe(true);
  });

  it("combos: return as a band, win chances floored to 5% (legs too)", async () => {
    const { gateCombos } = await import("@/lib/data/combos");
    const leg = { market_id: "m", side_index: 0 as const, question: "q", outcome: "o", event_id: "e", event: "E", url: "", ask: 0.4, fee: 0.01, q: 0.537, q_low: 0.512 };
    const c = { legs: 2, q: 0.2884, q_low: 0.262, price: 0.168, pays: 5.95, ret: 0.7167, has_edge: true, same_event: [], items: [leg, { ...leg, event_id: "f" }] };
    const g = { size: 2 as const, record: { combos: 10, roi_pct: 4 } as never, combos: [c] };
    const out = gateCombos([g], "free").groups[0]!.combos[0]!;
    expect(out.ret_range).toEqual([50, null]);
    expect(out.ret).toBe(0.5);
    for (const p of [out.q, out.q_low, ...out.items.flatMap((l) => [l.q, l.q_low])]) expect(Math.round(p * 20) / 20).toBeCloseTo(p, 10);
    expect(gateCombos([g], "pro").groups[0]!.combos[0]!.ret).toBe(0.7167);
  });

  it("a page past page 1 still answers page 1 (no paging for Free)", async () => {
    const { body } = await json(routes.markets(req("/api/markets?pg=7")));
    expect(body).toMatchObject({ page: 1, pages: 1 });
  });

  it("events with more than 10 markets are cut to 10", async () => {
    const s = await getStore();
    const many = Array.from({ length: 40 }, (_, i) => ({ ...s.markets[0]!, id: `x${i}` }));
    expect(eventBody(s, many, "free")!.markets).toHaveLength(10);
    expect(eventBody(s, many, "pro")!.markets).toHaveLength(40);
    const m = { ...s.markets[0]!, event_id: "big" };
    const store = { ...s, byEvent: new Map([["big", many.map((x) => ({ ...x, event_id: "big" }))]]) };
    expect(marketBody(store, m, "free").event_markets).toHaveLength(10);
  });
});

describe.each(["pro", "premium"] as const)("%s", (tier) => {
  beforeEach(() => { h.tier = tier; h.user = { id: `u-${tier}`, email: `${tier}@x.test` }; });

  it("every data route: exact numbers, no model internals", async () => {
    for (const [route, { status, body }] of Object.entries(await everyRoute())) {
      expect(status, route).toBe(200);
      expectPaidShape(body);
    }
  });

  it("page_size is capped at 200 and a page past the last is refused", async () => {
    const big = await json(routes.markets(req("/api/markets?ps=5000&g=0")));
    expect((big.body as { page_size: number }).page_size).toBeLessThanOrEqual(200);
    const { pages } = (await json(routes.markets(req("/api/markets?ps=200&g=0")))).body as { pages: number };
    expect((await json(routes.markets(req(`/api/markets?ps=200&g=0&pg=${pages}`)))).status).toBe(200);
    expect((await json(routes.markets(req(`/api/markets?ps=200&g=0&pg=${pages + 1}`)))).status).toBe(400);
  });
});

// RT3-01: ops/redteam/run3/curve_unband.py as a test. Free got banded win chances but the exact `mid` and the market's
// model curve; interpolating the curve at the mid gave the exact win chance (88% within 0.5 pp). Every curve Free can
// get (market body, /api/model/curve, /track-record) must leave it no better than the band plus the public mid alone.
describe("RT3-01: curve + mid can't un-band Free", () => {
  beforeEach(() => { h.tier = "free"; h.user = null; });
  const interp = (pts: { price: number; win_prob: number }[], p: number) => {
    if (p <= pts[0]!.price) return pts[0]!.win_prob;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      if (p <= b.price) return a.win_prob + ((b.win_prob - a.win_prob) * (p - a.price)) / (b.price - a.price);
    }
    return pts.at(-1)!.win_prob;
  };
  const segOf = (m: { niche: string; market_type: string; category: string }, l?: string) =>
    l === "nmt" ? `${m.niche}:${m.market_type}` : l === "niche" ? m.niche : l === "cat" ? `cat:${m.category}` : "all";

  it("market body and page props carry no curve for Free; paid and a counted reveal keep it", async () => {
    const s = await getStore();
    const m = s.markets.find((x) => x.best.model_level === "nmt")!;
    expect(marketBody(s, m, "free").curve).toBeNull();
    expect(marketBody(s, m, "free", "pro").curve).not.toBeNull();
    expect(marketBody(s, m, "pro").curve).not.toBeNull();
    const { body } = await json(routes.market(req(`/api/markets/${m.id}`), ctx("id", m.id)));
    expect((body as { curve: unknown }).curve).toBeNull();
  });

  it("/api/model/curve: Free gets only all / cat: segments, coarse (10¢ steps, 10 pp); Pro gets every segment exact", async () => {
    expect((await json(routes.curve(req("/api/model/curve?segment=nfl:moneyline&h=72")))).status).toBe(403);
    const c = (await json(routes.curve(req("/api/model/curve?segment=all&h=24")))).body as { points: { win_prob: number }[] };
    expect(c.points.length).toBeLessThanOrEqual(10);
    for (const p of c.points) expect(Math.round(p.win_prob * 10) / 10).toBeCloseTo(p.win_prob, 10);
    h.tier = "pro";
    expect((await json(routes.curve(req("/api/model/curve?segment=nfl:moneyline&h=72")))).status).toBe(200);
  });

  it("match rate of the curve attack over the whole scan is at chance level (band + mid alone)", async () => {
    const s = await getStore();
    const curves = new Map<string, { price: number; win_prob: number }[] | null>();
    let n = 0, attack = 0, chance = 0;
    for (const exact of s.markets) {
      const body = marketBody(s, exact, "free");   // what /api/markets/<id> and /m/<id> send Free
      const b = body.market.best;
      const key = `${segOf(body.market, b.model_level)}|${body.market.horizon_h}`;
      if (!curves.has(key)) {
        const r = await json(routes.curve(req(`/api/model/curve?${new URLSearchParams({ segment: key.split("|")[0]!, h: key.split("|")[1]! })}`)));
        curves.set(key, r.status === 200 ? (r.body as { points: { price: number; win_prob: number }[] }).points : null);
      }
      const pts = body.curve?.points ?? curves.get(key);
      const lo = b.win_prob, w = exact.best.win_prob;   // Free's band is [lo, lo + 5 pp)
      const clamp = (x: number) => Math.min(Math.max(x, lo), lo + 0.0499);
      const guess = clamp(pts ? interp(pts, b.mid) : b.mid);
      n++;
      attack += Number(Math.abs(guess - w) < 0.005);
      chance += Number(Math.abs(clamp(b.mid) - w) < 0.005);
    }
    expect(n).toBeGreaterThan(400);
    expect(attack / n).toBeLessThanOrEqual(chance / n + 0.03);
  });
});
