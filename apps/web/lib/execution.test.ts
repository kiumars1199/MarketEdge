import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, pyRound, type Book } from "./execution";

// apps/web/lib -> repo root
const FIX = fileURLToPath(new URL("../../../engine/tests/fixtures/book_expected.json", import.meta.url));
type Case = { q: number; fee_rate: number; min_edge: number; book: Book; expected: unknown };

function same(got: unknown, want: unknown, path: string): number {
  if (typeof want === "number") {
    expect(typeof got, path).toBe("number");
    expect(got as number, path).toBeCloseTo(want, 4);
    return 1;
  }
  if (want === null || typeof want !== "object") {
    expect(got, path).toBe(want);
    return 1;
  }
  if (Array.isArray(want)) {
    expect(Array.isArray(got), path).toBe(true);
    expect((got as unknown[]).length, path).toBe(want.length);
    return want.reduce((n: number, w, i) => n + same((got as unknown[])[i], w, `${path}[${i}]`), 0);
  }
  const g = got as Record<string, unknown>;
  expect(Object.keys(g).sort(), path).toEqual(Object.keys(want).sort());
  return Object.entries(want).reduce((n, [k, w]) => n + same(g[k], w, `${path}.${k}`), 0);
}

describe("execution check matches engine/execution.py", () => {
  it("reproduces book_expected.json", () => {
    const cases = JSON.parse(readFileSync(FIX, "utf8")) as Case[];
    let fields = 0;
    cases.forEach((c, i) => {
      fields += same(check(c.q, c.book, c.fee_rate, c.min_edge), c.expected, `case${i}`);
    });
    console.log(`fixture: ${cases.length} cases, ${fields} fields matched`);
    expect(cases.length).toBeGreaterThan(0);
  });

  it("wide spread is not worth it", () => {
    const book = { bids: [{ price: "0.40", size: "100" }], asks: [{ price: "0.62", size: "100" }] };
    expect(check(0.6, book, 0.05, 0.02).verdict).toBe("not worth it");
  });

  it("pyRound matches Python round()", () => {
    expect(pyRound(2.675, 2)).toBe(2.67); // binary value below the tie
    expect(pyRound(0.125, 2)).toBe(0.12); // exact tie -> even
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(-0.125, 2)).toBe(-0.12);
    expect(pyRound(-2.675, 2)).toBe(-2.67);
    expect(pyRound(0.0050000001, 2)).toBe(0.01);
  });
});
