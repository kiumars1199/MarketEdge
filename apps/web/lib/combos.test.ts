import { describe, expect, it } from "vitest";
import { closesWithinDay, combo, comboLabel, kalshiComboEdge, legGone, legProblem, pastDated, rangeLine, titleDateEnds } from "./combos";
import { winsAbout } from "./format";

// Hand-computed (docs/18 §5): A 60¢+1¢ fee, q 70%, low 65%; B 50¢+1¢, q 58%, low 54%; C 80¢+0.8¢, q 86%, low 82%.
const A = { ask: 0.6, fee: 0.01, q: 0.7, q_low: 0.65, event_id: "e1", event: "Event 1" };
const B = { ask: 0.5, fee: 0.01, q: 0.58, q_low: 0.54, event_id: "e2", event: "Event 2" };
const C = { ask: 0.8, fee: 0.008, q: 0.86, q_low: 0.82, event_id: "e3", event: "Event 3" };

describe("combo math", () => {
  it("two independent legs", () => {
    const c = combo([A, B]);
    expect(c.q).toBeCloseTo(0.406, 6);          // 0.70 × 0.58
    expect(c.q_low).toBeCloseTo(0.351, 6);      // 0.65 × 0.54
    expect(c.price).toBeCloseTo(0.3111, 6);     // 0.61 × 0.51
    expect(c.pays).toBeCloseTo(3.2144, 3);
    expect(c.ret).toBeCloseTo(0.1282546, 6);    // Marc #15/#74: at the cautious chance the card shows, 0.351 / 0.3111 − 1
    expect(c.has_edge).toBe(true);              // 0.351 > 0.3111
    expect(c.same_event).toEqual([]);
    // T-289: 40.6% read "1 in 2" (50%); winsAbout now says "4 in 10"
    expect(comboLabel(c, winsAbout(c.q))).toBe("Combo · 2 legs · pays 3.2x · wins about 4 in 10");
  });
  it("three legs: bigger return, lower chance", () => {
    const c = combo([A, B, C]);
    expect(c.q).toBeCloseTo(0.34916, 6);        // 0.406 × 0.86
    expect(c.q_low).toBeCloseTo(0.28782, 6);    // 0.351 × 0.82
    expect(c.price).toBeCloseTo(0.2513688, 7);  // 0.3111 × 0.808
    expect(c.ret).toBeCloseTo(0.1450108, 6);    // 0.28782 / 0.2513688 − 1
    expect(c.has_edge).toBe(true);
    expect(c.ret).toBeGreaterThan(combo([A, B]).ret);
    expect(c.q).toBeLessThan(combo([A, B]).q);
  });
  it("no edge when the cautious chance doesn't beat the price", () => {
    const c = combo([{ ...A, q_low: 0.55 }, { ...B, q_low: 0.5 }]);   // 0.275 < 0.3111
    expect(c.has_edge).toBe(false);
    // the return is at the same cautious chance, so it can't read positive while the check says no edge
    expect(c.ret).toBeCloseTo(-0.1160399, 6);   // 0.275 / 0.3111 − 1
    expect(c.ret < 0).toBe(!c.has_edge);
  });
  it("warns on same-event legs", () => {
    expect(combo([A, { ...B, event_id: "e1", event: "Event 1" }, C]).same_event).toEqual(["Event 1"]);
  });
  it("Kalshi combo edge = Q − ask − fee(ask)", () => {
    const k = kalshiComboEdge(0.406, 30);   // fee = ceil(7 × 0.30 × 0.70)¢ = ceil(1.47)¢ = 2¢
    expect(k.fee).toBeCloseTo(0.02, 6);
    expect(k.edge).toBeCloseTo(0.086, 6);   // 0.406 − 0.30 − 0.02
    expect(k.ret).toBeCloseTo(0.26875, 5);  // 0.086 / 0.32
  });
});

// Marc #15, #42, #52, #65 (Nov 20): which legs can go in a combo, and the intro line from the combos shown.
const NOW = 1795219200;   // 2026-11-21 00:00 UTC
const H = 3600;
type L = { market_id: string; event_id: string; event: string; question: string; closes_at?: number };
const leg = (o: Partial<L> = {}): L => ({
  market_id: "m1", event_id: "e1", event: "Lakers vs. Spurs", question: "Lakers vs. Spurs", closes_at: NOW + 6 * H, ...o,
});

describe("leg rules", () => {
  it("#15: legs from one event id are refused even when their titles differ", () => {
    const have = [leg()];
    const other = leg({ market_id: "m2", question: "Lakers vs. Spurs: total over 220.5", event: "Lakers vs. Spurs - More Markets" });
    expect(legProblem(other, have, NOW)).toMatch(/already has a bet from this event/);
  });
  it("#15: the same title on a different event id is allowed (the rule is the id, not the words)", () => {
    expect(legProblem(leg({ market_id: "m2", event_id: "e2" }), [leg()], NOW)).toBeNull();
  });
  it("the same market again is a side switch, not a clash", () => {
    expect(legProblem(leg(), [leg()], NOW)).toBeNull();
  });
  it("#42: a closed market is refused; a saved leg without closes_at (old tray) isn't refused for that", () => {
    expect(legProblem(leg({ closes_at: NOW - 1 }), [], NOW)).toMatch(/closed/);
    expect(legProblem(leg({ closes_at: NOW }), [], NOW)).toMatch(/closed/);
    expect(legProblem(leg({ closes_at: undefined }), [], NOW)).toBeNull();
  });
  it("#42/#52: an open market whose title names a day that is over is refused, and a saved one is dropped", () => {
    expect(legProblem(leg({ question: "Will the high in Dallas be 70°F on November 18?" }), [], NOW)).toMatch(/date has passed/);
    expect(legProblem(leg({ event: "NBA: Lakers vs. Spurs (Nov 19)" }), [], NOW)).toMatch(/date has passed/);
    expect(legGone(leg({ question: "Will it snow in NYC on 2026-11-19?" }), NOW)).toBe(true);
    expect(legGone(leg({ closes_at: NOW - 60 }), NOW)).toBe(true);
    expect(legGone(leg(), NOW)).toBe(false);
  });
  it("a yearless date is read against the market's close: \"by June 30?\" closing July 2027 is not past", () => {
    const jul27 = Date.UTC(2027, 6, 1) / 1000;
    expect(legProblem(leg({ question: "Will X happen by June 30?", closes_at: jul27 }), [], NOW)).toBeNull();
    expect(legGone(leg({ question: "Will X happen by June 30?", closes_at: jul27 }), NOW)).toBe(false);
    // and the #42 case still holds: a Nov 18 game that closes Nov 22 is past-dated on Nov 21
    expect(legGone(leg({ question: "Highest temperature in Dallas on November 18?", closes_at: NOW + 24 * H }), NOW)).toBe(true);
  });
});

describe("dates in titles", () => {
  it("a day is over only once it has ended everywhere (UTC−12)", () => {
    // Nov 20 ends at Nov 21 12:00 UTC: still Nov 20 somewhere at Nov 21 00:00 UTC
    expect(pastDated("Highest temperature in Honolulu on November 20?", NOW)).toBe(false);
    expect(pastDated("Highest temperature in Honolulu on November 20?", NOW + 12 * H)).toBe(true);
    expect(pastDated("Highest temperature in Paris on November 21?", NOW)).toBe(false);
  });
  it("reads full and short months, ordinals, years, ISO dates and ranges (the last day named counts)", () => {
    const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d + 1) / 1000 + 12 * H;
    expect(titleDateEnds("Fed decision on Dec. 9th, 2026", NOW)).toBe(day(2026, 12, 9));
    expect(titleDateEnds("Box office Nov 14-23", NOW)).toBe(day(2026, 11, 23));
    expect(pastDated("Box office Nov 14–23", NOW)).toBe(false);
    expect(titleDateEnds("on 2026-11-19", NOW)).toBe(day(2026, 11, 19));
    expect(titleDateEnds("Released by January 5?", NOW)).toBe(day(2027, 1, 5));   // no year: the nearest one
    expect(titleDateEnds("Will Tottenham win?", NOW)).toBeNull();
    expect(pastDated("Will Tottenham win?", NOW)).toBe(false);
  });
});

describe("closing within a day (#52)", () => {
  it("counts from the request time, not the scan", () => {
    expect(closesWithinDay(NOW + 23 * H, NOW)).toBe(true);
    expect(closesWithinDay(NOW + 24 * H, NOW)).toBe(true);
    expect(closesWithinDay(NOW + 24 * H + 1, NOW)).toBe(false);
    expect(closesWithinDay(NOW, NOW)).toBe(false);
  });
});

describe("intro line from the combos shown (#65)", () => {
  it("names only the leg counts and the payout range on screen", () => {
    expect(rangeLine([])).toBeNull();
    expect(rangeLine([{ legs: 2, pays: 3.21 }])).toBe("A two-leg combo paying 3.2x");
    expect(rangeLine([{ legs: 2, pays: 2.14 }, { legs: 2, pays: 4.5 }])).toBe("Two-leg combos paying 2.1x to 4.5x");
    expect(rangeLine([{ legs: 3, pays: 12.4 }, { legs: 2, pays: 2.14 }])).toBe("Two- and three-leg combos paying 2.1x to 12x");
  });
});
