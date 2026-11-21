import { describe, expect, it } from "vitest";
import { expectedReturn, feePerShare, multiBet } from "./calc";
import { FEE_RATE } from "./execution";

describe("calculators", () => {
  it("fee matches the Polymarket formula", () => {
    expect(feePerShare(0.5, FEE_RATE.sports)).toBeCloseTo(0.0125, 12);
    expect(feePerShare(0.9, FEE_RATE.crypto)).toBeCloseTo(0.0063, 12);
    expect(feePerShare(0.5, FEE_RATE.geopolitics)).toBe(0);
  });
  it("expected return without fee", () => {
    const r = expectedReturn(0.68, 0.92, 0)!;
    expect(r.edge).toBeCloseTo(0.24, 12);
    expect(r.roi_pct).toBeCloseTo(35.294, 2);
    expect(r.profit_100).toBeCloseTo(35.294, 2);
    expect(r.break_even).toBeCloseTo(0.68, 12);
  });
  it("expected return with fee", () => {
    const r = expectedReturn(0.5, 0.6, 0.05)!;
    expect(r.cost).toBeCloseTo(0.5125, 12);
    expect(r.edge).toBeCloseTo(0.0875, 12);
    expect(r.roi_pct).toBeCloseTo((0.0875 / 0.5125) * 100, 10);
  });
  it("negative return and bad input", () => {
    expect(expectedReturn(0.6, 0.5, 0)!.roi_pct).toBeCloseTo(-16.667, 2);
    expect(expectedReturn(0, 0.5, 0)).toBeNull();
    expect(expectedReturn(0.5, 1.2, 0)).toBeNull();
  });
  it("multi-bet EV sums independent bets", () => {
    const m = multiBet([
      { stake: 100, price: 0.5, winProb: 0.6, rate: 0 },   // +20
      { stake: 50, price: 0.25, winProb: 0.2, rate: 0 },   // −10
      { stake: 0, price: 0.5, winProb: 0.9, rate: 0 },     // ignored
    ])!;
    expect(m.valid).toBe(2);
    expect(m.stake).toBe(150);
    expect(m.expected_profit).toBeCloseTo(10, 9);
    expect(m.roi_pct).toBeCloseTo(6.667, 2);
    expect(m.all_lose).toBeCloseTo(0.4 * 0.8, 12);
    expect(multiBet([])).toBeNull();
  });
});
