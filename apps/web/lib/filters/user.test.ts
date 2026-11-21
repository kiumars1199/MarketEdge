import { describe, expect, it } from "vitest";
import { defaultState } from "./state";
import { resolveUserFilters } from "./user";

const ctx = { favorites: ["weather", "sports.nfl"], watchlistIds: new Set(["a"]) };

describe("resolveUserFilters", () => {
  it("turns favorites_only into topics and clears the server flags", () => {
    const r = resolveUserFilters({ ...defaultState(), favorites_only: true, watchlisted_only: true }, ctx);
    expect(r.state.topics).toEqual(["weather", "sports.nfl"]);
    expect(r.state.favorites_only).toBeUndefined();
    expect(r.state.watchlisted_only).toBeUndefined();
    expect([r.keep("a"), r.keep("b")]).toEqual([true, false]);
  });
  it("leaves state alone when no user filter is on", () => {
    const r = resolveUserFilters(defaultState(), ctx);
    expect(r.state.topics).toBeUndefined();
    expect(r.keep("b")).toBe(true);
  });
});
