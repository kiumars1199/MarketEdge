// T-291 #13: /about "Best bets right now" ranks by the return the card shows (shared cardReturn), over every match.
import { describe, expect, it } from "vitest";
import { betFigures } from "@/lib/betFigures";
import { gateMarket } from "@/lib/data/gate";
import { allRows, topByReturn } from "@/lib/topBets";
import type { Row } from "@/lib/filters/apply";
import type { FilterState } from "@/lib/filters/state";

const { getStore } = await import("@/lib/data/store");
const store = await getStore();
const F: Partial<FilterState> = { view: "flags", verdicts: ["worth it"] };

describe("about top 3", () => {
  for (const tier of ["premium", "free"] as const) {
    it(`${tier}: sorted by the card's return, highest first, one per game, from the whole list`, () => {
      const rows = allRows(store, F);
      const top = topByReturn(rows, 3, tier);
      expect(top.length).toBe(Math.min(3, new Set(rows.map((r) => r.market.event_id)).size));
      const shown = top.map((r) => betFigures(r.side).ret.roi ?? -Infinity);
      expect([...shown].sort((a, b) => b - a)).toEqual(shown);
      // nothing left out shows a higher return than the third card
      const best = Math.max(...rows.map(({ market, side }) => {
        const m = gateMarket(market, tier);
        return betFigures(m.sides.find((x) => x.side_index === side.side_index) ?? m.best).ret.roi ?? -Infinity;
      }));
      expect(shown[0]).toBe(best);
      expect(new Set(top.map((r) => r.market.event_id)).size).toBe(top.length);
      if (tier === "free") expect(top.every((r) => r.side.ranges)).toBe(true);   // Free is ranked on its bands
    });
  }

  it("a synthetic list: higher return wins regardless of position, and one card per event", () => {
    const base = allRows(store, F)[0]!;
    const mk = (id: string, ev: string, roi: number): Row => {
      const side = { ...base.side, roi_pct: roi, realistic_edge: null, ranges: undefined };
      return { market: { ...base.market, id, event_id: ev, sides: [side], best: side, us: undefined }, side };   // no US twin: the card shows this roi
    };
    const top = topByReturn([mk("a", "e1", 5), mk("b", "e2", 40), mk("c", "e1", 30), mk("d", "e3", 12)], 3, "premium");
    expect(top.map((r) => r.market.id)).toEqual(["b", "c", "d"]);
  });
});
