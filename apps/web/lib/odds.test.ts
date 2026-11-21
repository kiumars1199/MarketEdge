import { describe, expect, it } from "vitest";
import { formatOdds, fromAmerican, fromDecimal, toAmerican, toDecimal } from "./odds";

describe("odds", () => {
  it("converts both ways", () => {
    expect(toDecimal(0.5)).toBe(2);
    expect(fromDecimal(4)).toBe(0.25);
    expect(toAmerican(0.5)).toBe(-100);
    expect(toAmerican(0.25)).toBe(300);
    expect(toAmerican(0.8)).toBeCloseTo(-400);
    for (const p of [0.07, 0.25, 0.5, 0.68, 0.93]) {
      expect(fromAmerican(toAmerican(p)!)).toBeCloseTo(p, 10);
      expect(fromDecimal(toDecimal(p)!)).toBeCloseTo(p, 10);
    }
  });
  it("rejects out of range", () => {
    expect(toDecimal(0)).toBeNull();
    expect(toAmerican(1)).toBeNull();
    expect(fromAmerican(50)).toBeNull();
    expect(fromDecimal(1)).toBeNull();
  });
  it("formats per profile setting", () => {
    expect(formatOdds(0.68, "cents")).toBe("68%");
    expect(formatOdds(0.68, "percent")).toBe("68%");
    expect(formatOdds(0.055, "percent")).toBe("5.5%");
    expect(formatOdds(0.68, "decimal")).toBe("1.47x");
    expect(formatOdds(0.68, "american")).toBe("−213");
    expect(formatOdds(0.25, "american")).toBe("+300");
    expect(formatOdds(null, "decimal")).toBe("—");
    expect(formatOdds(Number.NaN, "cents")).toBe("—");
  });
});
