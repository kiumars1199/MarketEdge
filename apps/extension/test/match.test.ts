import { describe, expect, it } from "vitest";
import { badgeText, buildIndex, match, slugFrom } from "../src/match";
import type { Market, Side } from "../src/types";

const side = (outcome: string, ask: number, win_prob: number, roi_pct: number, i: 0 | 1 = 0): Side => ({
  side_index: i, outcome, ask, mid: ask, fee: 0, win_prob, edge: win_prob - ask, roi_pct,
  model_level: "nmt", model_neff: 100, model_events: 50,
});
let n = 0;
const mk = (question: string, market_type: string, sides: Side[], best = 0): Market => ({
  id: String(++n), question, event: "e", slug: "s", url: "u", niche: "x", market_type,
  hours_to_close: 10, closes_at: 0, spread: 0.01, sides, best: sides[best],
});

// Real leaf strings seen on polymarket.com (probe of 2026-11-16).
const weather = [
  mk("Will the highest temperature in Chicago be between 56-57°F on November 17?", "multi-outcome", [side("Yes", 0.61, 0.7, 13.7), side("No", 0.42, 0.3, -30, 1)]),
  mk("Will the highest temperature in Chicago be between 58-59°F on November 17?", "multi-outcome", [side("Yes", 0.29, 0.14, -50), side("No", 0.74, 0.86, 14.3, 1)], 1),
  mk("Will the highest temperature in Chicago be 45°F or below on November 17?", "multi-outcome", [side("Yes", 0.001, 0, -100), side("No", 0.999, 0.999, -0.1, 1)], 1),
];
const nfl = [
  mk("Colts vs. Texans", "moneyline", [side("Colts", 0.16, 0.12, -25), side("Texans", 0.85, 0.98, 15.3, 1)], 1),
  mk("Spread: Colts (-1.5)", "spreads", [side("Colts", 0.2, 0.2, 0.2), side("Texans", 0.8, 0.8, -0.1, 1)]),
  mk("Spread: Colts (-2.5)", "spreads", [side("Colts", 0.2, 0.2, 0.3), side("Texans", 0.8, 0.8, -0.1, 1)]),
  mk("1H Spread: Texans (-3.5)", "spreads", [side("Colts", 0.2, 0.2, 9), side("Texans", 0.8, 0.8, -0.1, 1)]),
  mk("Texans 1H Team Total: O/U 13.5", "totals", [side("Over", 0.5, 0.5, 9), side("Under", 0.5, 0.5, -1, 1)]),
];
const politics = [mk("Will Gavin Newsom win the 2028 Democratic presidential nomination?", "multi-outcome", [side("Yes", 0.3, 0.35, 15), side("No", 0.7, 0.65, -8, 1)])];

describe("match", () => {
  const w = buildIndex(weather);
  it("matches weather rows by temperature label", () => {
    expect(match("56-57°F", w)?.market.id).toBe(weather[0].id);
    expect(match(" 58-59°F ", w)?.market.id).toBe(weather[1].id);
    expect(match("45°F or below", w)?.market.id).toBe(weather[2].id);
  });
  it("ignores near-misses: legend, FAQ, comments, other rows", () => {
    for (const t of ["56-57°F 60%", "62-63°F", "What does a price of 61¢ for \"56-57°F\" mean?", "62-63", "Buy Yes", "$2,825 Vol."])
      expect(match(t, w)).toBeNull();
  });
  it("matches the full question text", () => {
    expect(match("Will the highest temperature in Chicago be between 56-57°F on November 17?", w)?.market.id).toBe(weather[0].id);
  });
  it("sports section headings pick the best market of that type, skipping used ones", () => {
    const i = buildIndex(nfl);
    expect(match("Moneyline", i)).toEqual({ market: nfl[0], heading: true });
    expect(match("Spreads", i)?.market.id).toBe(nfl[2].id);
    expect(match("Spreads", i, new Set([nfl[2].id]))?.market.id).toBe(nfl[1].id);
    expect(match("Totals", i)).toBeNull();
    for (const t of ["ind", "hou", "COV", "Draw", "Game Lines", "Colts"]) expect(match(t, i)).toBeNull();
  });
  it("politics rows by candidate name; not team names on sports pages", () => {
    expect(match("Gavin Newsom", buildIndex(politics))?.market.id).toBe(politics[0].id);
    const soccer = [mk("Will Coventry City FC win on 2026-11-21?", "moneyline", [side("Yes", 0.4, 0.4, 1), side("No", 0.6, 0.6, 1, 1)])];
    expect(match("Coventry City FC", buildIndex(soccer))).toBeNull();
    expect(match("Moneyline", buildIndex(soccer))?.heading).toBe(true);
  });
});

describe("badgeText", () => {
  it("positive estimated return", () => {
    expect(badgeText(weather[0])).toEqual({ text: "Yes: Pays 1.6x · won 70% before · market says 61% · +14% estimated", positive: true });
    expect(badgeText(nfl[0], true).text).toBe("Texans: Pays 1.2x · won 98% before · market says 85% · +15% estimated");
    expect(badgeText(nfl[2], true).text).toBe("Spread: Colts (-2.5) · Colts: Pays 5.0x · won 20% before · market says 20% · +0.3% estimated");
  });
  it("no edge is muted and uses the first side", () => {
    expect(badgeText(weather[2])).toEqual({ text: "Market says 0% · no edge", positive: false });
  });
  it("never uses banned words or cents", () => {
    for (const m of [...weather, ...nfl, ...politics]) {
      const t = badgeText(m, true).text.toLowerCase();
      for (const bad of ["worth it", "pick", "lock", "guaranteed", "sure thing", "ai says", "¢"]) expect(t).not.toContain(bad);
    }
  });
});

describe("slugFrom", () => {
  it("event and sports paths", () => {
    expect(slugFrom("/event/highest-temperature-in-chicago-on-november-17-2026")).toBe("highest-temperature-in-chicago-on-november-17-2026");
    expect(slugFrom("/event/some-event/some-market")).toBe("some-event");
    expect(slugFrom("/sports/nfl/nfl-ind-hou-2026-11-20")).toBe("nfl-ind-hou-2026-11-20");
    expect(slugFrom("/sports/nfl")).toBeNull();
    expect(slugFrom("/")).toBeNull();
  });
});
