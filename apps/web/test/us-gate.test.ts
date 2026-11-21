// Polymarket US quote (docs/research/polymarket-us.md): Free sees where to bet and the US price, never the exact
// US edge or return (those are Pro numbers, like the international ones). T-302: Free gets them as bands (low end),
// like the side's numbers, so the "On Polymarket US" filter, its count and the card's stars match Pro's.
import { describe, expect, it } from "vitest";
import { gateMarket } from "@/lib/data/gate";
import type { StoreMarket } from "@/lib/types";

const { getStore } = await import("@/lib/data/store");
const store = await getStore();

describe("us quote gate", () => {
  const base = store.flags[0] ?? store.markets[0];
  const m = { ...base, us: { slug: "aec-x", url: "https://polymarket.us/event/x", side: 0, ask: 0.52, fee: 0.0237,
    edge: 0.031, roi_pct: 5.7 } } as StoreMarket;

  it("free: link and price kept, edge and return banded (never exact)", () => {
    const g = gateMarket(m, "free");
    expect(g.us).toEqual({ ...m.us, edge: 0.02, roi_pct: 5 });   // 3.1¢ -> the 2-5¢ band, 5.7% -> the 5-10% band
    expect(m.us!.edge).toBe(0.031);   // the stored market is not mutated
  });

  it("free: a band clears min_edge exactly when the exact edge does; no live book stays null", () => {
    for (const [edge, want] of [[0.0199, 0], [0.02, 0.02], [-0.004, -0.01], [0.25, 0.2]] as const)
      expect(gateMarket({ ...m, us: { ...m.us!, edge } } as StoreMarket, "free").us!.edge).toBe(want);
    const none = gateMarket({ ...m, us: { ...m.us!, ask: null, fee: null, edge: null, roi_pct: null } } as StoreMarket, "free").us!;
    expect([none.edge, none.roi_pct]).toEqual([null, null]);
  });

  it("paid: unchanged", () => {
    expect(gateMarket(m, "pro").us).toEqual(m.us);
  });

  it("no US twin: stays null", () => {
    expect(gateMarket({ ...base, us: null } as StoreMarket, "free").us).toBeNull();
  });
});
