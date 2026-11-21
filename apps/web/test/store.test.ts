import { describe, expect, it } from "vitest";
import { getStore } from "@/lib/data/store";
import { derive } from "@/lib/data/derive";

describe("store (fixture)", async () => {
  const store = await getStore();

  it("loads markets, flags, model, backtest and builds indexes", async () => {
    expect(store.markets).toHaveLength(501);
    expect(store.flags).toHaveLength(151);   // 150 best + 1 edge (docs/18)
    expect(store.meta.markets_scanned).toBe(14629);
    expect(store.byId.get("6417673")?.question).toBe("Colts vs. Texans");
    expect(store.byEvent.get("1282887")?.length).toBeGreaterThan(0);
    expect(store.bySlug.get("nfl-ind-hou-2026-11-20")?.some((m) => m.id === "6417673")).toBe(true);
    expect(store.model.nodes.length).toBeGreaterThan(0);
    expect(store.backtest.results).toBeTruthy();
    expect(store.facets.categories.sports).toBe(324);   // +1 long shot fixture
    expect(await getStore()).toBe(store); // cached
  });

  it("derives period, city, temp kind and frequency", () => {
    const q = (s: string) => store.markets.find((m) => m.question === s)!;
    expect(q("Miami (OH) vs. Kent State: 1H Moneyline").derived.period).toBe("1H");
    expect(q("Miami (OH) vs. Kent State: 1Q Moneyline").derived.period).toBe("1Q");
    expect(q("Colts vs. Texans").derived.period).toBe("full");

    const paris = q("Will the highest temperature in Paris be 16°C on November 17?");
    expect(paris.derived.city).toBe("Paris");
    expect(paris.derived.temp_kind).toBe("high");
    expect(paris.derived.frequency).not.toContain("daily"); // "daily-temperature" is not "daily"
    expect(q("Will the highest temperature in Seoul (Incheon) be 15°C on November 17?").derived.city).toBe("Seoul (Incheon)");

    const eth = store.markets.find((m) => m.tags.includes("ethereum") && m.tags.includes("weekly"))!;
    expect(eth.derived.frequency).toEqual(expect.arrayContaining(["recurring", "weekly"]));
    expect(eth.derived.crypto_window).toBe("weekly");
    expect(eth.derived.recurring).toBe(true);
  });

  it("is_live when hours_to_close <= 0", () => {
    const m = store.markets[0];
    expect(derive({ ...m, hours_to_close: 0 }).is_live).toBe(true);
    expect(derive({ ...m, hours_to_close: 3 }).is_live).toBe(false);
  });

  it("search finds the NFL game by team name, prefix and pasted URL", () => {
    const hits = store.search.find("Texans")!;
    expect(hits.has("6417673")).toBe(true);
    expect(store.search.find("colts tex")!.has("6417673")).toBe(true);
    expect(store.search.find("colts zzz")!.size).toBe(0);
    const url = store.search.find("https://polymarket.com/event/nfl-ind-hou-2026-11-20?tid=1")!;
    expect(url.has("6417673")).toBe(true);
    expect(store.search.find("")).toBeNull();
  });
});
