import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { getStore } from "@/lib/data/store";
import { apply, comparator, GROUP_ROWS, pickSide, type Row } from "@/lib/filters/apply";
import { FilterState, defaultState, type FilterInput } from "@/lib/filters/state";
import { parse, serialize } from "@/lib/filters/url";
import { TAXONOMY, topicsOf } from "@/lib/taxonomy";
import type { StoreMarket } from "@/lib/types";

const st = (patch: FilterInput = {}) => FilterState.parse(patch);

describe("url round-trip", () => {
  const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }).filter((x) => !Object.is(x, -0));
  const unit = fc.double({ noNaN: true, min: 0, max: 1 }).filter((x) => !Object.is(x, -0));
  const list = <T,>(xs: readonly T[]) => fc.option(fc.uniqueArray(fc.constantFrom(...xs), { minLength: 1 }), { nil: undefined });
  const o = <T,>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });
  const state = fc.record({
    q: o(fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim() !== "")),
    view: fc.constantFrom("markets", "flags"),
    tier: fc.constantFrom("best", "edge", "all"),
    categories: list(["sports", "crypto", "weather", "other"] as const),
    exclude_categories: list(["sports", "crypto"] as const),
    topics: list(["sports.nfl", "weather", "sports.soccer.ucl"]),
    market_types: list(["moneyline", "spreads", "yes/no"] as const),
    periods: list(["full", "1H", "4Q"] as const),
    side: fc.constantFrom("best", "yes", "no", "favorite", "underdog"),
    price_min: o(unit), price_max: o(unit), pays_min: o(finite), pays_max: o(finite),
    win_prob_min: o(finite), win_prob_max: o(finite), tz: o(fc.constantFrom("UTC", "America/New_York", "Etc/GMT+5")), edge_min: o(finite),
    edge_low_positive: o(fc.boolean()), roi_min: o(finite), validated_only: o(fc.boolean()),
    verdicts: list(["worth it", "thin", "no book"] as const),
    retention_min: o(finite), capacity_min_usd: o(finite), min_events: o(fc.integer({ min: -5, max: 5000 })),
    closes_within_h: o(finite), closes_after_h: o(finite), live_only: o(fc.boolean()),
    frequency: list(["recurring", "15M", "weekly"] as const),
    volume_min: o(finite), volume_24h_min: o(finite), liquidity_min: o(finite), spread_max: o(finite),
    watchlisted_only: o(fc.boolean()), favorites_only: o(fc.boolean()), group_by_event: fc.boolean(),
    sort: fc.record({ key: fc.constantFrom("edge", "roi", "newest", "competitive", "pays"), dir: fc.constantFrom("asc", "desc") }),
    page: fc.integer({ min: 1, max: 99 }), page_size: fc.integer({ min: 1, max: 200 }),
  }, { requiredKeys: [] });

  it("parse(serialize(x)) == x for 200 random states", () => {
    fc.assert(
      fc.property(state, (raw) => {
        const x = FilterState.parse(raw);
        expect(parse(serialize(x))).toEqual(x);
      }),
      { numRuns: 200 },
    );
  });

  it("omits defaults and ignores unknown keys / bad values", () => {
    expect(serialize(defaultState()).toString()).toBe("");
    expect(parse("zzz=1&c=sports,nope&e=abc&s=roi.sideways&ps=999").categories).toBeUndefined();
    const f = parse("c=sports&t=sports.nfl,sports.cfb&mt=spreads,totals&e=0.03&conf=1&cw=24&s=edge.desc");
    expect(f).toMatchObject({ categories: ["sports"], topics: ["sports.nfl", "sports.cfb"], market_types: ["spreads", "totals"], edge_min: 0.03, edge_low_positive: true, closes_within_h: 24, sort: { key: "edge", dir: "desc" } });
    expect(serialize(f).toString()).toBe("c=sports&t=sports.nfl%2Csports.cfb&mt=spreads%2Ctotals&e=0.03&conf=1&cw=24&s=edge.desc");
  });
});

describe("apply() on the fixture", async () => {
  const store = await getStore();
  // Expected counts hand-checked with a separate Python count over test/fixtures.
  const total = (p: FilterInput) => apply(store, st({ group_by_event: false, ...p })).total;

  it.each([
    ["default view hides long shots (< 40%)", {}, 476],
    // +1 vs. the original fixture: Lane C's tier-"edge" long shot (id 9900010, Yes at 10¢, 14%), docs/18 §2
    ["wp=0 turns the floor off", { win_prob_min: 0 }, 501],
    ["sports", { categories: ["sports"] }, 305],
    ["hide sports", { exclude_categories: ["sports"] }, 171],
    // flags-view counts over every flag: "On Polymarket US" (on by default, T-302) off; test/us-filter.test.ts covers it
    ["flags view", { view: "flags", us: false }, 150],
    ["most likely to win (flags, wp 0.8)", { view: "flags", us: false, win_prob_min: 0.8 }, 114],
    ["topic sports.nfl", { topics: ["sports.nfl"] }, 34],
    ["spreads+totals, edge >= 3¢", { market_types: ["spreads", "totals"], edge_min: 0.03 }, 53],
    ["confident only", { edge_low_positive: true }, 180],
    ["yes side, price <= 25¢, no floor", { side: "yes", price_max: 0.25, win_prob_min: 0 }, 144],   // +1: the long shot
    ["closes within 24 h", { closes_within_h: 24 }, 199],
    ["first-half markets (1H + \"1st Half\")", { periods: ["1H"] }, 18],
    ["weekly", { frequency: ["weekly"] }, 23],
    ["validated", { validated_only: true }, 233],
    ["big capacity (flags)", { view: "flags", us: false, capacity_min_usd: 1000 }, 100],
    ["missing volume_24h excluded by a min filter", { volume_24h_min: 1 }, 0],
  ] as [string, FilterInput, number][])("%s", (_name, patch, n) => {
    expect(total(patch)).toBe(n);
  });

  it("search narrows to the Texans game", () => {
    const p = apply(store, st({ q: "texans", group_by_event: false, win_prob_min: 0 }));
    expect(p.rows.map((r) => r.market.question)).toContain("Colts vs. Texans");
    expect(p.rows.every((r) => /texans/i.test(r.market.question + r.market.event))).toBe(true);
  });

  it("sorts by roi desc with the best first, ties by closes_at", () => {
    const p = apply(store, st({ group_by_event: false, page_size: 200 }));
    expect(p.rows[0].market.id).toBe("6674492");
    for (let i = 1; i < p.rows.length; i++) {
      const [a, b] = [p.rows[i - 1], p.rows[i]];
      expect(a.side.roi_pct > b.side.roi_pct || (a.side.roi_pct === b.side.roi_pct && a.market.closes_at <= b.market.closes_at)).toBe(true);
    }
  });

  it("missing sort values go last in both directions", () => {
    const rows: Row[] = store.markets.slice(0, 3).map((m, i) => ({ market: { ...m, volume_24h: i === 1 ? undefined : i * 10 } as StoreMarket, side: m.best }));
    for (const dir of ["asc", "desc"] as const) expect(rows.slice().sort(comparator({ key: "volume_24h", dir })).at(-1)!.market.volume_24h).toBeUndefined();
  });

  it("pickSide favorite/underdog", () => {
    const m = store.byId.get("6417673")!;
    expect(pickSide(m, "favorite")!.outcome).toBe("Texans");
    expect(pickSide(m, "underdog")!.outcome).toBe("Colts");
  });

  it("groups by event, best row first, pages over groups, each cut to GROUP_ROWS", () => {
    const p = apply(store, st({ page_size: 20 }));
    expect(p.total).toBe(476);
    expect(p.total_groups).toBe(297);
    const cmp = comparator(defaultState().sort);
    const seen: string[] = [];
    let rows = 0;
    for (let page = 1; page <= p.pages; page++) {
      const q = apply(store, st({ page_size: 20, page }));
      expect(q.groups!.length).toBeLessThanOrEqual(20);
      expect(q.rows).toEqual(q.groups!.flatMap((g) => g.rows));
      for (const g of q.groups!) {
        seen.push(g.event_id);
        rows += g.size;
        expect(g.best).toBe(g.rows[0]);
        expect(g.rows.length).toBe(Math.min(g.size, GROUP_ROWS));
        for (const r of g.rows) expect(cmp(g.best, r)).toBeLessThanOrEqual(0);
      }
    }
    expect(new Set(seen).size).toBe(297); // every group exactly once
    expect(seen).toHaveLength(297);
    expect(rows).toBe(476);
    expect(apply(store, st({ page_size: 20, page: p.pages + 1 })).groups).toHaveLength(0);
    // groups ordered by their best row
    expect(apply(store, st({})).groups![0].best.market.id).toBe("6674492");
  });

  it("facets are counts for the current filter minus that facet", () => {
    const p = apply(store, st({ categories: ["sports"] }));
    // category facet ignores the category filter
    expect(p.facets.categories).toMatchObject({ sports: 305, weather: 122, finance: 16, crypto: 16, culture: 7, tech: 6, geopolitics: 4, politics: 0 });
    // other facets respect it
    expect(p.facets.market_types).toMatchObject({ totals: 107, props: 97, spreads: 77, moneyline: 24, "yes/no": 0 });
    expect(p.facets.topics["sports.nfl"]).toBe(34);
    expect(p.facets.topics.weather).toBe(0);
    // topic facet ignores the topic filter
    expect(apply(store, st({ topics: ["sports.nfl"] })).facets.topics["sports.cfb"]).toBeGreaterThan(0);
  });

  it("taxonomy: every market lands in exactly one category node and a topic", () => {
    const tops = ["sports", "crypto", "weather", "finance", "politics", "geopolitics", "culture", "tech", "other"];
    for (const m of store.markets) {
      const ids = topicsOf(m);
      expect(tops.filter((t) => ids.has(t))).toHaveLength(1);
      if (TAXONOMY[m.category]?.children) expect([...ids].some((id) => id.startsWith(m.category + "."))).toBe(true);
    }
    expect(topicsOf(store.byId.get("6417673")!).has("sports.nfl")).toBe(true);
  });
});
