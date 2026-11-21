// Run 4: catch-all regression matrix. Every route in the build's app-path-routes-manifest (dynamic segments filled),
// plus discovery files and unknown paths, GET and POST: status, content-type, cache-control, x-robots / noindex.
// usage: node routes.mjs <base> <manifest.json> <out.txt> [cookie-file]
import fs from "node:fs";
const [base, manifest, outFile, cookieFile] = process.argv.slice(2);
const cookie = cookieFile ? fs.readFileSync(cookieFile, "utf8").trim() : "";
const routes = Object.values(JSON.parse(fs.readFileSync(manifest, "utf8")));
const fill = (r) => r.replace("[...missing]", "zz-missing").replace("[...path]", "x").replace("[collection]", "watchlist").replace("[slug]", "x")
  .replace("/m/[id]", "/m/6654466").replace("/event/[id]", "/event/1309855").replace("/markets/[id]", "/markets/6654466").replace("/events/[id]", "/events/1309855")
  .replace("/users/[id]", "/users/00000000-0000-0000-0000-000000000000").replace("/dashboards/[id]", "/dashboards/x").replace(/\[id\]/g, "x");
const extra = [
  "/robots.txt", "/sitemap.xml", "/llms.txt", "/icon.svg", "/apple-icon.png", "/opengraph-image", "/twitter-image", "/favicon.ico", "/manifest.webmanifest",
  "/m/6654466/opengraph-image", "/m/6654466/twitter-image",
  "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/api/mcp", "/.well-known/openid-configuration", "/.well-known/security.txt",
  "/flags", "/flags?x=1", "/no-such-page", "/a/b/c", "/api/no-such-route", "/api/mcp/extra", "/m/6654466/extra", "/admin/nope", "/_next/static/nope.js",
  "/_next/static/chunks/nope.js", "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/c.js", "/v1/customers",
];
const list = [...new Set([...routes.map(fill), ...extra])].sort();
const out = [`# ${base} ${new Date().toISOString()} ${cookie ? "signed in (cookie)" : "signed out"}`, "method path -> status | content-type | cache-control | robots"];
for (const path of list) {
  for (const method of ["GET", "POST"]) {
    if (method === "POST" && /^\/(api\/stripe\/webhook|api\/account$|api\/auth\/signout)/.test(path)) continue;   // don't mutate
    let line;
    try {
      const r = await fetch(base + path, { method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { "content-type": "application/json", origin: base } : {}) }, body: method === "POST" ? "{}" : undefined });
      const body = await r.text();
      const robots = r.headers.get("x-robots-tag") ?? (/<meta name="robots" content="([^"]+)"/.exec(body)?.[1] ?? "");
      const nf = /<title>Page not found/.test(body) ? " [404 page]" : "";
      line = `${method.padEnd(4)} ${path} -> ${r.status}${r.headers.get("location") ? ` loc=${r.headers.get("location").replace(base, "")}` : ""} | ${(r.headers.get("content-type") ?? "").split(";")[0]} | ${r.headers.get("cache-control") ?? ""} | ${robots}${nf}`;
    } catch (e) { line = `${method} ${path} -> ERR ${e}`; }
    out.push(line);
  }
}
for (const [label, h] of [["RSC: 1", { rsc: "1" }], ["Next-Router-Prefetch", { rsc: "1", "next-router-prefetch": "1" }]]) {
  const r = await fetch(base + "/no-such-page", { headers: { ...h, ...(cookie ? { cookie } : {}) }, redirect: "manual" });
  out.push(`GET  /no-such-page (${label}) -> ${r.status} | ${r.headers.get("content-type")} | ${r.headers.get("cache-control")}`);
}
for (const m of ["PUT", "DELETE", "PATCH"]) {
  const r = await fetch(base + "/api/no-such-route", { method: m, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), origin: base } });
  out.push(`${m} /api/no-such-route -> ${r.status} | ${r.headers.get("content-type")}`);
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log(`${list.length} paths -> ${outFile}`);
