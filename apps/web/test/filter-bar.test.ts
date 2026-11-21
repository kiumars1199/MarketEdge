// Mark's filter bar (Nov 20): three values ↔ FilterState, round trip.
import { describe, expect, it } from "vitest";
import { barPatch, barValues } from "@/components/screener/FilterBar";
import { defaultState } from "@/lib/filters/state";

const win = { today: { closes_after_h: undefined, closes_within_h: 8.5 }, week: { closes_after_h: undefined, closes_within_h: 100 } };

describe("filter bar", () => {
  it("round-trips sport, multiplier and date", () => {
    const v = { sport: "t:sports.soccer", mult: "2-3", date: "week" };
    const s = { ...defaultState(), ...barPatch(v, win) };
    expect(s.topics).toEqual(["sports.soccer"]);
    expect([s.pays_min, s.pays_max]).toEqual([2, 3]);
    expect(s.closes_within_h).toBe(100);
    expect(barValues(s, win)).toEqual(v);
  });
  it("a category, open-ended multipliers and any date", () => {
    const s = { ...defaultState(), ...barPatch({ sport: "c:weather", mult: "5+", date: "" }, win) };
    expect(s.categories).toEqual(["weather"]);
    expect([s.pays_min, s.pays_max]).toEqual([5, undefined]);
    expect(s.closes_within_h).toBeUndefined();
    expect(barValues({ ...s, pays_min: undefined, pays_max: 1.5 }, win).mult).toBe("lt1.5");
  });
  it("all empty clears the three filters", () => {
    expect(barPatch({ sport: "", mult: "", date: "" }, win)).toEqual({
      topics: undefined, categories: undefined, pays_min: undefined, pays_max: undefined, closes_after_h: undefined, closes_within_h: undefined });
  });
});
