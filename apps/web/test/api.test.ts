import { describe, expect, it } from "vitest";
import type { BacktestResponse, Curve, EventResponse, MarketResponse, MarketsResponse, MetaResponse } from "@/lib/api";
import { GET as meta } from "@/app/api/meta/route";
import { GET as markets } from "@/app/api/markets/route";
import { GET as market } from "@/app/api/markets/[id]/route";
import { GET as flags } from "@/app/api/flags/route";
import { GET as event } from "@/app/api/events/[id]/route";
import { GET as bySlug, OPTIONS as bySlugOptions } from "@/app/api/events/by-slug/[slug]/route";
import { GET as curve } from "@/app/api/model/curve/route";
import { GET as backtest } from "@/app/api/backtest/route";
import { apply } from "@/lib/filters/apply";
import { FilterState } from "@/lib/filters/state";
import { buildStore, loadRaw } from "@/lib/data/store";
import type { Market } from "@/lib/types";

const req = (path: string) => new Request(`http://test${path}`);
const ctx = <T,>(p: T) => ({ params: Promise.resolve(p) });
const json = async <T,>(r: Response | Promise<Response>, status = 200): Promise<T> => {
  const res = await r;
  expect(res.status).toBe(status);
  return res.json() as Promise<T>;
};

describe("API contract (fixture store)", () => {
  it("/api/meta", async () => {
    const b = await json<MetaResponse>(meta());
    expect(b.meta.markets_scanned).toBe(14629);
    expect(b.counts).toMatchObject({ markets: 501, flags: 151 });   // incl. the tier-"edge" long shot (docs/18)
    expect(b.facets.categories.sports).toBe(324);   // +1 long shot fixture
    expect(b.facets.topics["sports.nfl"]).toBe(40);
  });

  it("/api/markets filters, groups and caps the page at 200", async () => {
    const b = await json<MarketsResponse>(markets(req("/api/markets?c=sports&ps=999&bogus=1")));
    expect(b.total).toBe(305);
    expect(b.page_size).toBe(50); // invalid ps falls back to the default
    expect(b.rows.every((r) => r.market.category === "sports")).toBe(true);
    const g = b.groups![0];
    expect(b.rows[g.start].market.event_id).toBe(g.event_id);
    expect(b.groups!.reduce((n, x) => n + x.count, 0)).toBe(b.rows.length);
    expect(b.groups!.length).toBeLessThanOrEqual(50);
    expect(b.rows.length).toBeLessThanOrEqual(200);
    const big = await json<MarketsResponse>(markets(req("/api/markets?ps=200&wp=0")));
    expect(big.rows.length).toBeLessThanOrEqual(200);

    const flat = await json<MarketsResponse>(markets(req("/api/markets?g=0&ps=200&wp=0")));
    expect(flat.rows).toHaveLength(200);
    expect(flat.groups).toBeUndefined();
    expect(flat.rows[0].side).toBeDefined();

    const yes = await json<MarketsResponse>(markets(req("/api/markets?g=0&side=yes&wp=0&q=texans")));
    expect(yes.rows.every((r) => r.side.side_index === 0)).toBe(true);
  });

  it("/api/flags forces the flags view", async () => {
    const b = await json<MarketsResponse>(flags(req("/api/flags?view=markets&g=0&us=0")));
    expect(b.total).toBe(150);
    expect(b.rows.every((r) => r.market.execution)).toBe(true);
    // T-302: "On Polymarket US" is on unless us=0: only bets placeable on Polymarket US above min_edge
    const us = await json<MarketsResponse>(flags(req("/api/flags?view=markets&g=0")));
    expect(us.total).toBe(34);
    expect(us.rows.every((r) => r.market.us?.ask != null && r.market.us.edge! >= 0.02)).toBe(true);
  });

  it("/api/markets/[id] returns market, curve, backtest record and event siblings", async () => {
    const b = await json<MarketResponse>(market(req("/api/markets/6417673"), ctx({ id: "6417673" })));
    expect(b.market.question).toBe("Colts vs. Texans");
    expect(b.segment).toBe("nfl:moneyline");
    expect(b.curve?.points.length).toBeGreaterThan(5);
    expect(b.curve?.horizon_h).toBe(72);
    expect(b.backtest?.flags).toBe(604);
    expect(b.event_markets.every((m) => m.event_id === "1282887" && m.id !== "6417673")).toBe(true);
    await json(market(req("/api/markets/nope"), ctx({ id: "nope" })), 404);
  });

  it("/api/events/[id] and by-slug (with CORS)", async () => {
    const e = await json<EventResponse>(event(req("/api/events/1282887"), ctx({ id: "1282887" })));
    expect(e.markets.some((m) => m.id === "6417673")).toBe(true);
    expect(e.markets[0].best.roi_pct).toBeGreaterThanOrEqual(e.markets.at(-1)!.best.roi_pct);

    const res = await bySlug(req("/api/events/by-slug/nfl-ind-hou-2026-11-20"), ctx({ slug: "nfl-ind-hou-2026-11-20" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const s = await json<EventResponse>(res);
    expect(s.event_id).toBe("1282887");
    expect(s.flags.every((f) => f.execution)).toBe(true);
    expect((await bySlug(req("/x"), ctx({ slug: "nope" }))).headers.get("access-control-allow-origin")).toBe("*");
    expect(bySlugOptions().status).toBe(204);
  });

  it("/api/model/curve and /api/backtest", async () => {
    const c = await json<Curve>(curve(req("/api/model/curve?segment=nfl:moneyline&h=72")));
    expect(c.points[0].price).toBeLessThan(c.points.at(-1)!.price);
    await json(curve(req("/api/model/curve?segment=nope&h=72")), 404);
    const b = await json<BacktestResponse>(backtest());
    expect(b.chosen?.taker.flags).toBe(9666);
    expect(b.chosen?.by_category.sports.flags).toBe(604);
  });
});

describe("apply() timing", () => {
  it("p95 < 150 ms over 15k rows", { retry: 1 }, async () => {
    const raw = await loadRaw();
    const copy = (m: Market, k: number) => ({ ...m, id: `${m.id}-${k}`, event_id: `${m.event_id}-${k}`, slug: `${m.slug}-${k}` });
    const rows = Array.from({ length: 30 }, (_, k) => raw.markets.markets.map((m) => copy(m, k))).flat();
    const store = buildStore({ ...raw, markets: { ...raw.markets, markets: rows } });
    expect(store.markets).toHaveLength(15030);   // 501 fixture markets × 30

    const states = [FilterState.parse({}), FilterState.parse({ categories: ["sports"], q: "texans" }), FilterState.parse({ sort: { key: "win_prob", dir: "desc" }, group_by_event: false })];
    for (const s of states) apply(store, s); // warm up (taxonomy membership memo)
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      apply(store, states[i % states.length]);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`apply() over 15k rows: p50 ${times[15].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(150);
  });
});
