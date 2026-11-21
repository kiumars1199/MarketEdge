// Audit fail 7: the side panel shows counts the way the web app does (docs/18 §4), never raw.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCount } from "../src/format";

describe("formatCount (kept in sync with apps/web/lib/format.ts)", () => {
  it("is exact under 1,000 and rounds down above", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1313.7)).toBe("1.3K");
    expect(formatCount(9666)).toBe("9.6K");
    expect(formatCount(12_340)).toBe("12.3K");   // T-288: one decimal (was "12K")
    expect(formatCount(16_896)).toBe("16.8K");
    expect(formatCount(1_000)).toBe("1K");
    expect(formatCount(1_333_014)).toBe("1.3M");
    expect(formatCount(null)).toBe("—");
  });

  it("the side panel prints no raw toLocaleString counts", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../src/sidepanel.ts"), "utf8");
    expect(src).not.toMatch(/model_(neff|events)\)?\.toLocaleString|Math\.round\(b\.model_neff\)/);
    expect(src).toMatch(/formatCount\(b\.model_events\)/);
  });
});
