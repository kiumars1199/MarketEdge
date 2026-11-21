// #53: the save dialog's suggested name (lib/presets-name.ts)
import { describe, expect, it } from "vitest";
import { defaultState, type FilterInput, FilterState } from "@/lib/filters/state";
import { suggestViewName } from "@/lib/presets-name";
import { TAXONOMY } from "@/lib/taxonomy";

const s = (p: FilterInput) => FilterState.parse(p);

describe("suggestViewName", () => {
  it("is “My view” with nothing on", () => {
    expect(suggestViewName(defaultState())).toBe("My view");
    expect(suggestViewName(s({ view: "flags", sort: { key: "win_prob", dir: "desc" } }))).toBe("My view");
  });
  it("names topics, payout and chance in plain words", () => {
    expect(suggestViewName(s({ topics: ["sports.nfl"], pays_min: 1.5, win_prob_min: 0.7 })))
      .toBe(`${TAXONOMY["sports.nfl"].label} · Pays 1.5x+ · 70%+ to win`);
    expect(suggestViewName(s({ pays_min: 1.2, pays_max: 2 }))).toBe("Pays 1.2x–2x");
    expect(suggestViewName(s({ categories: ["crypto"], closes_within_h: 24 }))).toBe("Crypto · Closes in 24h");
    expect(suggestViewName(s({ exclude_categories: ["sports"], closes_within_h: 72 }))).toBe("No sports · Closes in 3 days");
    expect(suggestViewName(s({ q: " chiefs ", live_only: true }))).toBe("“chiefs” · Live");
  });
  it("keeps at most three parts, ignores unknown topics and the 0% (long shots) choice", () => {
    expect(suggestViewName(s({ topics: ["nope"], win_prob_min: 0 }))).toBe("My view");
    expect(suggestViewName(s({ side: "favorite", edge_low_positive: true, validated_only: true, live_only: true })))
      .toBe("Favorites · Live · Confident");
  });
  it("never passes the dialog's 60-character limit", () => {
    const long = suggestViewName(s({ q: "x".repeat(100) }));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
  });
});
