import { describe, expect, it } from "vitest";
import { kelly, withFee } from "./kelly";

describe("kelly", () => {
  it("q=0.6, p=0.5 → full Kelly 20%", () => {
    const k = kelly({ q: 0.6, p: 0.5, bankroll: 1000, fraction: 1 })!;
    expect(k.f_star).toBeCloseTo(0.2, 12);
    expect(k.stake).toBeCloseTo(200, 9);
    expect(k.shares).toBeCloseTo(400, 9);
    expect(k.capped).toBe(false);
  });
  it("quarter Kelly scales the stake", () => {
    expect(kelly({ q: 0.6, p: 0.5, bankroll: 1000, fraction: 0.25 })!.stake).toBeCloseTo(50, 9);
  });
  it("no edge → stake 0 (never negative)", () => {
    const k = kelly({ q: 0.4, p: 0.5, bankroll: 1000, fraction: 1 })!;
    expect(k.f_star).toBeLessThan(0);
    expect(k.stake).toBe(0);
  });
  it("caps at live capacity", () => {
    const k = kelly({ q: 0.6, p: 0.5, bankroll: 1000, fraction: 1, capacity: 120 })!;
    expect(k).toMatchObject({ stake: 120, shares: 240, capped: true });
  });
  it("fee raises the effective price", () => {
    expect(withFee(0.5, 0.05)).toBeCloseTo(0.5125, 12);
    expect(kelly({ q: 0.6, p: withFee(0.5, 0.05), bankroll: 1000, fraction: 1 })!.f_star).toBeLessThan(0.2);
  });
  it("rejects bad input", () => {
    expect(kelly({ q: 0.6, p: 1, bankroll: 1000, fraction: 1 })).toBeNull();
    expect(kelly({ q: Number.NaN, p: 0.5, bankroll: 1000, fraction: 1 })).toBeNull();
  });
});
