// @vitest-environment jsdom
// AUDIT run 3 fail 5 / BP 96: zod's JIT probe (new Function) tripped the CSP in the browser. Browser-loaded schema
// modules build their schemas with jitless on, so the probe never runs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globalConfig } from "zod/v4/core";

describe("zod in the browser", () => {
  it("is jitless once a schema module loads", async () => {
    await import("@/lib/filters/state");
    expect(globalConfig.jitless).toBe(true);
  });

  it("every lib/ and components/ module that imports zod imports @/lib/zod-jitless first", () => {
    const root = path.resolve(__dirname, "..");
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) {
          const src = readFileSync(p, "utf8");
          const zod = src.search(/^import [^;]*from "zod"/m);
          if (zod >= 0 && !(src.indexOf('import "@/lib/zod-jitless";') >= 0 && src.indexOf('import "@/lib/zod-jitless";') < zod)) bad.push(path.relative(root, p));
        }
      }
    };
    walk(path.join(root, "lib"));
    walk(path.join(root, "components"));
    expect(bad).toEqual([]);
  });
});
