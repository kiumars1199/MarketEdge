// docs/18 §2–3 against the fixtures: two tiers, Pays searches both, the 10x / 14% example lands in tier "edge".
import { describe, expect, it } from "vitest";
import { COMBO_PAYS, browseCombos, gateCombos, suggestCombos } from "@/lib/data/combos";
import { getStore } from "@/lib/data/store";
import { apply } from "@/lib/filters/apply";
import { FilterState, type FilterInput } from "@/lib/filters/state";
import { parse, serialize } from "@/lib/filters/url";

const LONG_SHOT = "9900010";   // fixture: 10¢, our chance 14%, edge +4 pts, tier "edge"
// us: false: these check tiers and pay bands over every flag; the fixture's edge-tier bets carry no Polymarket US quote
const run = async (f: FilterInput) => apply(await getStore(), FilterState.parse({ view: "flags", us: false, group_by_event: false, page_size: 200, ...f }));
const ids = (p: Awaited<ReturnType<typeof run>>) => p.rows.map((r) => r.market.id);

describe("suggested combos", () => {
  it("tier-best legs on different events closing within 24 h, Q_low beats the price, top 5 per size", async () => {
    const store = await getStore();
    const groups = suggestCombos(store);
    expect(groups.map((g) => g.size)).toEqual([2, 3]);
    for (const g of groups) {
      expect(g.combos.length).toBeGreaterThan(0);
      expect(g.combos.length).toBeLessThanOrEqual(5);
      for (const c of g.combos) {
        expect(c.items).toHaveLength(g.size);
        expect(new Set(c.items.map((l) => l.event_id)).size).toBe(g.size);
        expect(c.q_low).toBeGreaterThan(c.price);
        for (const l of c.items) {
          const m = store.flagsById.get(l.market_id)!;
          expect(m.tier ?? "best").toBe("best");
          expect(m.hours_to_close).toBeLessThanOrEqual(24);
        }
      }
      expect(g.combos.map((c) => c.ret)).toEqual([...g.combos.map((c) => c.ret)].sort((a, b) => b - a));
    }
  });
  it("hides a leg count that lost money in testing; Free gets bands", async () => {
    const store = await getStore();
    const losing = { ...store, backtest: { ...store.backtest, combos: { ...store.backtest.combos, "3": { combos: 50, roi_pct: -4 } } } };
    expect(suggestCombos(losing).map((g) => g.size)).toEqual([2]);
    const free = gateCombos(suggestCombos(store), "free");
    expect(free.groups[0]!.combos[0]!.ret_range).toBeDefined();
  });
});

describe("combos page (docs/19 P5)", () => {
  it("each payout floor: pays at least that much, legs on different events, cautious chance beats the price", async () => {
    const store = await getStore();
    const counts: number[] = [];
    for (const min of COMBO_PAYS) {
      const groups = browseCombos(store, min);
      counts.push(groups.reduce((n, g) => n + g.combos.length, 0));
      for (const g of groups) {
        expect(g.combos.length).toBeLessThanOrEqual(20);
        expect(g.record.roi_pct).toBeGreaterThan(0);
        for (const c of g.combos) {
          expect(c.pays).toBeGreaterThanOrEqual(min);
          expect(new Set(c.items.map((l) => l.event_id)).size).toBe(g.size);
          expect(c.q_low).toBeGreaterThan(c.price);
          for (const l of c.items) expect(store.flagsById.get(l.market_id)!.hours_to_close).toBeLessThanOrEqual(24);
        }
        expect(g.combos.map((c) => c.ret)).toEqual([...g.combos.map((c) => c.ret)].sort((a, b) => b - a));
        const uses = new Map<string, number>();
        for (const l of g.combos.flatMap((c) => c.items)) uses.set(l.market_id, (uses.get(l.market_id) ?? 0) + 1);
        expect(Math.max(...uses.values())).toBeLessThanOrEqual(3);   // no leg fills the page
      }
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect([...counts]).toEqual([...counts].sort((a, b) => b - a));   // a higher floor never shows more
  });
  it("the top combo per leg count is the Best bets row's top combo when it pays 2x+", async () => {
    const store = await getStore();
    for (const g of suggestCombos(store)) {
      const top = browseCombos(store, 2).find((b) => b.size === g.size)?.combos[0];
      if (g.combos[0]!.pays >= 2) expect(top?.ret).toBe(g.combos[0]!.ret);
    }
  });
});

describe("flag tiers", () => {
  it("default is tier best", async () => {
    const p = await run({});
    expect(p.total).toBeGreaterThan(0);
    expect(p.rows.every((r) => (r.market.tier ?? "best") === "best")).toBe(true);
    expect(ids(p)).not.toContain(LONG_SHOT);
  });
  it("the 10x bet with a 14% chance shows in tier edge (chance floor off)", async () => {
    const p = await run({ tier: "edge", win_prob_min: 0 });
    expect(ids(p)).toContain(LONG_SHOT);
    expect(p.rows.every((r) => r.market.tier === "edge")).toBe(true);
  });
  it("Pays 10x+ and a typed '10x' search hit both tiers; Biggest payout only reorders (QA-A #68)", async () => {
    expect(ids(await run({ pays_min: 10 }))).toContain(LONG_SHOT);
    expect(ids(await run({ q: "10x" }))).toContain(LONG_SHOT);
    expect(ids(await run({ sort: { key: "pays", dir: "desc" }, win_prob_min: 0 })).sort()).toEqual(ids(await run({ win_prob_min: 0 })).sort());
  });
  it("the pays facet counts the edge tier", async () => {
    expect((await run({})).facets.pays["10x+"]).toBeGreaterThanOrEqual(1);
  });
  it("tier round-trips through the URL; the markets view ignores it", async () => {
    const f = FilterState.parse({ view: "flags", tier: "edge" });
    expect(serialize(f).get("tier")).toBe("edge");
    expect(parse(serialize(f)).tier).toBe("edge");
    expect(parse("tier=bogus").tier).toBe("best");
    const all = apply(await getStore(), FilterState.parse({ view: "markets", tier: "best", win_prob_min: 0, page_size: 200, group_by_event: false }));
    expect(all.rows.map((r) => r.market.id)).toContain(LONG_SHOT);
    expect(all.rows.find((r) => r.market.id === LONG_SHOT)?.market.tier).toBe("edge");
  });
});

describe("P5: Pays dropdown counts match the list", () => {
  const bands = [[1, 1.5], [1.5, 2], [2, 3], [3, 5], [5, 10], [10, undefined]] as const;
  const keys = ["<1.5x", "1.5-2x", "2-3x", "3-5x", "5-10x", "10x+"];
  for (const view of ["flags", "markets"] as const) {
    it(`each band's count equals the rows it shows (${view}, ungrouped)`, async () => {
      const base = await run({ view });
      for (const [i, [lo, hi]] of bands.entries()) {
        const p = await run({ view, pays_min: lo, pays_max: hi });
        expect(base.facets.pays[keys[i]!] ?? 0, keys[i]).toBe(p.total);
      }
    });
  }
  it("grouped: a band's count is at least the event groups it shows", async () => {
    const base = apply(await getStore(), FilterState.parse({ view: "flags" }));
    for (const [i, [lo, hi]] of bands.entries()) {
      const p = apply(await getStore(), FilterState.parse({ view: "flags", pays_min: lo, pays_max: hi }));
      expect(base.facets.pays[keys[i]!] ?? 0).toBeGreaterThanOrEqual(p.total_groups ?? 0);
    }
  });
  it("2–3x lifts the 40% chance floor (bets under 40% show)", async () => {
    const p = await run({ view: "markets", pays_min: 2, pays_max: 3 });
    expect(p.rows.every((r) => r.side.ask > 1 / 3 && r.side.ask <= 0.5)).toBe(true);
    expect(p.rows.some((r) => r.side.win_prob < 0.4)).toBe(true);
  });
});
