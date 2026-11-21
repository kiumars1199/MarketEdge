// T-295: scripts/perf/landing-js.mjs (the 150 kB landing budget check) on a fake build dir.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { entryKeys, firstLoadJs, htmlScripts } from "../scripts/perf/landing-js.mjs";

function fakeBuild() {
  const d = mkdtempSync(path.join(os.tmpdir(), "next-"));
  const put = (f: string, body: string) => { mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), body); };
  for (const f of ["webpack", "main", "layout", "page", "lazy", "other"]) put(`static/chunks/${f}.js`, f.repeat(100));
  put("static/css/a.css", "x");
  put("build-manifest.json", JSON.stringify({ rootMainFiles: ["static/chunks/webpack.js", "static/chunks/main.js"] }));
  put("app-build-manifest.json", JSON.stringify({ pages: {
    "/layout": ["static/chunks/webpack.js", "static/chunks/layout.js", "static/css/a.css"],
    "/page": ["static/chunks/page.js"],
    "/pricing/page": ["static/chunks/other.js"],
  } }));
  put("server/app/index.html", `<script src="/_next/static/chunks/polyfills.js" noModule=""></script><script src="/_next/static/chunks/lazy.js" async></script><script src="/_next/static/chunks/page.js"></script>`);
  return d;
}

describe("landing-js.mjs", () => {
  it("entry keys: root layout, nested layouts that exist, the page", () => {
    expect(entryKeys("/", {})).toEqual(["/layout", "/page"]);
    expect(entryKeys("/a/b", { "/a/layout": [] })).toEqual(["/layout", "/a/layout", "/a/b/page"]);
  });

  it("counts root main files, layout and page entries, and lazy chunks the prerendered HTML loads; JS only, once each", () => {
    const d = fakeBuild();
    expect(htmlScripts(d, "/")).toEqual(["static/chunks/lazy.js", "static/chunks/page.js"]);
    const r = firstLoadJs(d, "/", (b: Buffer) => b.length);
    expect(r.files.map((f: { file: string }) => f.file.split("/").pop()).sort()).toEqual(["layout.js", "lazy.js", "main.js", "page.js", "webpack.js"]);
    expect(r.gzip).toBe(r.bytes);
    expect(firstLoadJs(d, "/pricing", (b: Buffer) => b.length).files).toHaveLength(4);   // not prerendered here: no HTML
    expect(() => firstLoadJs(d, "/nope")).toThrow(/no page entry/);
  });
});
