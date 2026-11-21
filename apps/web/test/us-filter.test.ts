// T-302 (docs/OVERHAUL.md §G2): "On Polymarket US" is on by default for every tier; with it on, Best bets are the
// bets listed on Polymarket US whose US edge clears min_edge, ranked by the US return, and every count uses that set.
import { describe, expect, it } from "vitest";
import { bestBetsCount, bestBetsQuery, bestBetsRows } from "@/lib/data/counts";
import { freeView } from "@/lib/data/gate";
import { FREE_BEST_BETS_A_DAY } from "@/lib/entitlements";
import { freeSample, freeUsOn } from "@/lib/data/respond";
import { apply } from "@/lib/filters/apply";
import { FilterState, defaultState } from "@/lib/filters/state";
import { onUs, usActive } from "@/lib/filters/us";
import { parse, serialize } from "@/lib/filters/url";
import type { Store } from "@/lib/data/store";

const { getStore } = await import("@/lib/data/store");
const store = await getStore();
const MIN = store.meta.rule.min_edge;
const fixtureUs = store.flags.filter((m) => m.closes_at > store.meta.scanned_at && onUs(m, MIN));

describe("On Polymarket US filter", () => {
  it("is on by default and round-trips as us=0 when turned off", () => {
    expect(defaultState().us).toBe(true);
    expect(serialize(defaultState()).has("us")).toBe(false);
    expect(serialize(FilterState.parse({ us: false })).get("us")).toBe("0");
    expect(parse("us=0").us).toBe(false);
    expect(parse("").us).toBe(true);
  });

  it("onUs: listed, priced, and the US edge at least min_edge", () => {
    const q = { slug: "x", url: "https://polymarket.us/event/x", side: 0 as const, ask: 0.5, fee: 0.02, edge: 0.02, roi_pct: 3.8 };
    expect(onUs({ us: q }, 0.02)).toBe(true);
    expect(onUs({ us: { ...q, edge: 0.0199 } }, 0.02)).toBe(false);
    expect(onUs({ us: { ...q, ask: null, edge: null } }, 0.02)).toBe(false);
    expect(onUs({ us: null }, 0.02)).toBe(false);
    expect(onUs({}, 0.02)).toBe(false);
  });

  it("Best bets with it on = exactly the US set, ranked by US return", () => {
    const rows = bestBetsRows(store);
    expect(rows.length).toBe(34);
    expect(rows.every((r) => onUs(r.market, MIN))).toBe(true);
    const roi = rows.map((r) => r.market.us!.roi_pct!);
    expect(roi).toEqual([...roi].sort((a, b) => b - a));
    // every US bet that passes the other Best bets filters is in, and turning the filter off widens the list
    const wide = bestBetsRows(store, { us: false });
    expect(new Set(rows.map((r) => r.market.id))).toEqual(new Set(wide.filter((r) => onUs(r.market, MIN)).map((r) => r.market.id)));
    expect(wide.length).toBeGreaterThan(rows.length);
    expect(fixtureUs.length).toBeGreaterThanOrEqual(rows.length);
  });

  it("the one count uses the same set, for Pro and for Free's banded view", () => {
    expect(bestBetsCount(store).total).toBe(34);
    expect(bestBetsCount(freeView(store)).total).toBe(34);
    expect(apply(store, bestBetsQuery()).total).toBe(34);
  });

  it("Free's daily 10 come from the US set when it has at least 10", () => {
    const free = freeView(store);
    expect(freeUsOn(free)).toBe(true);
    const ids = new Set(bestBetsRows(free).map((r) => r.market.id));
    for (const key of ["u:a", "u:b", "ip:1.2.3.4"]) {
      const s = freeSample(free, key);
      expect(s.size).toBe(FREE_BEST_BETS_A_DAY);
      for (const id of s) expect(ids.has(id)).toBe(true);
    }
  });

  it("with fewer than 10 US bets, Free's sample falls back to every Best bet", () => {
    const keep = new Set(fixtureUs.slice(0, 5).map((m) => m.id));
    const few: Store = { ...store, flags: store.flags.map((m) => (m.us && !keep.has(m.id) ? { ...m, us: null } : m)) };
    expect(bestBetsRows(few).length).toBeLessThan(FREE_BEST_BETS_A_DAY);
    expect(freeUsOn(few)).toBe(false);
    expect(freeSample(few, "u:a").size).toBe(FREE_BEST_BETS_A_DAY);
    // QA-A #26/#57: the Free count follows the Free list (every venue here), the paid count the US set
    expect(bestBetsCount(few, { free: true }).total).toBe(bestBetsRows(few, { us: false }).length);
    expect(bestBetsCount(few).total).toBe(bestBetsRows(few).length);
  });

  it("is a no-op on a scan without US coverage, so Best bets never empties", () => {
    const old: Store = { ...store, meta: { ...store.meta, us: undefined } };
    expect(usActive(old.meta, bestBetsQuery())).toBe(false);
    expect(bestBetsRows(old).length).toBe(bestBetsRows(store, { us: false }).length);
    const failed: Store = { ...store, meta: { ...store.meta, us: { ...store.meta.us!, ok: false } } };
    expect(bestBetsRows(failed).length).toBe(bestBetsRows(store, { us: false }).length);
  });

  it("the markets view ignores it", () => {
    const f = FilterState.parse({ view: "markets", group_by_event: false });
    expect(apply(store, f).total).toBe(apply(store, { ...f, us: false }).total);
  });
});
