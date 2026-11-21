#!/usr/bin/env node
// T-295 (docs/OVERHAUL.md §C): first-load JS of a route, gzipped, from the `next build` output. Fails above the budget.
//   node scripts/perf/landing-js.mjs [--route /] [--budget-kb 150] [--dir .next]
// First-load JS = the root main files (webpack runtime, main-app) + every JS chunk the root layout and the route's page
// entry list in app-build-manifest.json, deduplicated, each gzipped (level 9, like `next build`'s size column).
// Lazy chunks (next/dynamic, import()) are not in the entry lists; but a lazy component the server renders is referenced
// by the page's HTML and loads with it. So for a prerendered route the script tags in its HTML
// (server/app/<route>.html) are added too: what a first visit really downloads.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

/** Entry keys for an app route: "/" → ["/layout", "/page"]; "/pricing" → ["/layout", "/pricing/layout"?, "/pricing/page"]. */
export function entryKeys(route, pages) {
  const segs = route.split("/").filter(Boolean);
  const keys = ["/layout"];
  for (let i = 1; i <= segs.length; i++) {
    const k = `/${segs.slice(0, i).join("/")}/layout`;
    if (pages[k]) keys.push(k);
  }
  keys.push(segs.length ? `/${segs.join("/")}/page` : "/page");
  return keys;
}

/** JS files a prerendered route's HTML references (`/_next/static/...` → `static/...`), or [] when not prerendered. */
export function htmlScripts(dir, route) {
  const html = path.join(dir, "server/app", `${route === "/" ? "index" : route.slice(1)}.html`);
  if (!existsSync(html)) return [];
  // <script nomodule> (Next's polyfills) is skipped by every browser that runs modules
  const src = readFileSync(html, "utf8").replace(/<script[^>]*\bnomodule\b[^>]*>/gi, "");
  return [...new Set([...src.matchAll(/\/_next\/(static\/[^"'\s>\\]+?\.js)/g)].map((m) => m[1]))];
}

/** { files, bytes, gzip } for `route`, from a build dir. */
export function firstLoadJs(dir, route, gz = (b) => gzipSync(b, { level: 9 }).length) {
  const app = JSON.parse(readFileSync(path.join(dir, "app-build-manifest.json"), "utf8")).pages;
  const build = JSON.parse(readFileSync(path.join(dir, "build-manifest.json"), "utf8"));
  const keys = entryKeys(route, app);
  if (!app[keys.at(-1)]) throw new Error(`no page entry ${keys.at(-1)} in ${dir}/app-build-manifest.json`);
  const files = [...new Set([...(build.rootMainFiles ?? []), ...keys.flatMap((k) => app[k] ?? []), ...htmlScripts(dir, route)])]
    .filter((f) => f.endsWith(".js"));
  let bytes = 0, gzip = 0;
  const each = files.map((f) => {
    const buf = readFileSync(path.join(dir, f));
    const g = gz(buf);
    bytes += buf.length;
    gzip += g;
    return { file: f, gzip: g };
  });
  return { route, files: each, bytes, gzip };
}

function main(argv) {
  const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const route = arg("--route", "/");
  const budget = Number(arg("--budget-kb", "150")) * 1000;
  const dir = arg("--dir", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.next"));
  const r = firstLoadJs(dir, route);
  for (const f of r.files.sort((a, b) => b.gzip - a.gzip)) console.log(`${(f.gzip / 1000).toFixed(1).padStart(7)} kB  ${f.file}`);
  const ok = r.gzip <= budget;
  console.log(`${route}: first-load JS ${(r.gzip / 1000).toFixed(1)} kB gzipped (${(r.bytes / 1000).toFixed(0)} kB raw, ${r.files.length} files); budget ${budget / 1000} kB: ${ok ? "OK" : "OVER"}`);
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
