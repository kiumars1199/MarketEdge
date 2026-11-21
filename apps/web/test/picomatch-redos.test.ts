// AUDIT run 2 fail 2: picomatch <= 4.0.7 (GHSA-fc5q-39xc-vjpf, ReDoS) has no patched release, so every 4.x copy
// in the install, 2.x included, must be the vendored fix (pnpm-workspace.yaml override -> vendor/picomatch).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("picomatch ReDoS (GHSA-fc5q-39xc-vjpf)", () => {
  it("both lockfiles resolve every picomatch (2.x and 4.x) to the vendored fix", () => {
    for (const app of ["web", "extension"]) {
      const lock = readFileSync(path.resolve(import.meta.dirname, `../../${app}/pnpm-lock.yaml`), "utf8");
      expect(lock, app).toMatch(/picomatch@4': file:\.\.\/\.\.\/vendor\/picomatch|picomatch@4: file:\.\.\/\.\.\/vendor\/picomatch/);
      expect(lock.match(/picomatch@\d+\.\d+\.\d+/g) ?? [], app).toEqual([]);
      expect(lock.match(/^\s+picomatch: \d/gm) ?? [], app).toEqual([]);
    }
    const vendored = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../vendor/picomatch/package.json"), "utf8"));
    expect(vendored.version).toBe("4.0.8-kismet.1");
  });

  it("the advisory PoC finishes fast and the patterns keep their meaning", () => {
    const pm = createRequire(import.meta.url)(path.resolve(import.meta.dirname, "../../../vendor/picomatch")) as
      { isMatch: (s: string, p: string) => boolean };
    for (const [p, s] of [["+(*)", "a".repeat(28) + "/"], ["+(*a)", "a".repeat(28) + "b"], ["*(*a)", "a".repeat(28) + "b"]] as const) {
      const t = performance.now();
      pm.isMatch(s, p);
      expect(performance.now() - t, p).toBeLessThan(200);
    }
    expect(pm.isMatch("aaa", "+(*a)")).toBe(true);
    expect(pm.isMatch("aab", "+(*a)")).toBe(false);
    expect(pm.isMatch("x.js.js", "+(*.js)")).toBe(true);
  });
});
