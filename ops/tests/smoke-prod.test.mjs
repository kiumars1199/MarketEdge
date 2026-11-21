// ops/smoke-prod.sh against a fake site on 127.0.0.1 (the real check was run by hand against a local production
// build). Proves PASS on a healthy site and FAIL + exit 1 when a control is missing.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { ROOT } from "../lib.mjs";

const broken = new Set();
let hits = 0;
const SEC = { "content-security-policy": "default-src 'self'", "strict-transport-security": "max-age=63072000",
  "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin", "x-content-type-options": "nosniff" };
const server = createServer((req, res) => {
  const base = `http://${req.headers.host}`;
  const send = (code, body = "", headers = {}) => { res.writeHead(code, headers); res.end(body); };
  const p = new URL(req.url, base).pathname;
  if (broken.has(p)) return send(200, "oops");
  if (p === "/api/health") return send(200, req.headers.authorization === "Bearer s3cret" ? '{"ok":true,"db":"ok","data":{"source":"supabase"},"ratelimit":"on"}' : '{"ok":true}');
  if (p === "/") return send(200, `<html><head><meta property="og:image" content="${base}/opengraph-image?a=1&amp;b=2"/></head></html>`, SEC);
  if (p === "/opengraph-image") return send(200, "png", { "content-type": "image/png" });
  if (p === "/api/alerts/run" || p === "/api/settle/run") return send(401);
  if (p === "/robots.txt") return send(200, `User-Agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
  if (p === "/sitemap.xml") return send(200, "<urlset></urlset>");
  if (p === "/api/meta") return send(200, "{}");
  if (p === "/api/ext/telemetry") return send(++hits > 30 ? 429 : 204);
  send(404);
});
let url;
before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); url = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const run = (env = {}) => promisify(execFile)("bash", [join(ROOT, "ops/smoke-prod.sh"), url], { env: { ...process.env, ...env } });

test("healthy site: every check passes, health details checked with CRON_SECRET", async () => {
  hits = 0;
  const { stdout } = await run({ CRON_SECRET: "s3cret" });
  assert.doesNotMatch(stdout, /FAIL/);
  assert.match(stdout, /PASS {2}\/api\/health details "ratelimit":"on"/);
  assert.match(stdout, /PASS {2}og:image .*opengraph-image\?a=1&b=2/);
  assert.match(stdout, /21 passed, 0 failed/);
});

test("a missing control fails the run", async () => {
  hits = 0;
  broken.add("/api/alerts/run");
  broken.add("/admin");
  try {
    await assert.rejects(run(), (e) => e.code === 1 && /FAIL {2}\/api\/alerts\/run → 401/.test(e.stdout) && /FAIL {2}\/admin → 404/.test(e.stdout));
  } finally {
    broken.clear();
  }
});
