// Run 4 audit: MCP-a (disclaimer on every tool result, including SDK input-validation errors) on BOTH protocol eras,
// and MCP-b (Origin matrix), black-box against the wired production build.
// usage: W=http://localhost:3161 O=http://localhost:3160 OUT=mcp-eras.txt node mcp-eras.mjs
// Uses the real MCP client SDK (the same package the vitest uses): 'legacy' = the 2025 initialize handshake,
// { pin: "2026-07-28" } = the modern era (server/discover). Tokens: JWTs with a client_id claim, accepted by the in-repo
// Supabase mock (real OAuth issuance is BLOCKED).
import fs from "node:fs";
const NM = process.env.NM ?? "/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules";
const { Client, StreamableHTTPClientTransport } = await import(`${NM}/@modelcontextprotocol/client/dist/index.mjs`);
const W = process.env.W ?? "http://localhost:3161";
const O = process.env.O ?? "http://localhost:3160";
const SB = `${O}/e2e-mock/supabase`;
const SERVICE = "e2e-service";
const DISC = "Market analytics, not financial advice. Based on past results. 18+.";
const out = [];
const log = (...a) => { const s = a.join(" "); out.push(s); console.log(s); };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64u({ alg: "none", typ: "JWT" })}.${b64u(claims)}.mock`;
const now = () => Math.floor(Date.now() / 1000);
const RUN = Date.now();
async function seed(email, sub = {}) {
  await fetch(`${SB}/auth/v1/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const { url } = await (await fetch(`${SB}/_inbox?email=${encodeURIComponent(email)}`)).json();
  const s = await (await fetch(`${SB}/auth/v1/token?grant_type=pkce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auth_code: new URL(url).searchParams.get("code") }) })).json();
  const svc = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
  if (Object.keys(sub).length) await fetch(`${SB}/rest/v1/subscriptions?user_id=eq.${s.user.id}`, { method: "PATCH", headers: svc, body: JSON.stringify(sub) });
  const t = new Date().toISOString();
  await fetch(`${SB}/rest/v1/profiles?user_id=eq.${s.user.id}`, { method: "PATCH", headers: svc, body: JSON.stringify({ accepted_terms_at: t, onboarded_at: t, first_bets_at: t }) });
  return { email, id: s.user.id };
}
const tok = (u) => jwt({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp: now() + 3600, client_id: "client-audit4", session_id: "s1" });
const textOf = (r) => (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const verdict = (t) => (typeof t === "string" && t.trimEnd().endsWith(DISC) ? "ends-with-disclaimer" : "NO-DISCLAIMER-AT-END");

// one Premium user per era so the 60/min limit never interferes; Free for the refusal path
const premA = await seed(`audit4-eras-premA-${RUN}@example.com`, { tier: "premium", status: "active" });
const premB = await seed(`audit4-eras-premB-${RUN}@example.com`, { tier: "premium", status: "active" });
const premC = await seed(`audit4-eras-premC-${RUN}@example.com`, { tier: "premium", status: "active" });
const free = await seed(`audit4-eras-free-${RUN}@example.com`);
log(`seeded premium x3 + free (run ${RUN})`);

const CASES = [
  ["best_bets", { limit: 0 }], ["best_bets", { limit: 25.5 }], ["best_bets", { limit: "50" }], ["best_bets", { page: 1001 }],
  ["best_bets", { tier: "bogus" }], ["best_bets", { categories: ["admin"] }], ["best_bets", { pays_min: 0 }],
  ["best_bets", { closing_within_hours: -1 }], ["best_bets", { pays_min: 10, pays_max: 2 }], ["best_bets", { limit: 3 }],
  ["search_markets", { query: "" }], ["search_markets", { query: "x".repeat(121) }], ["search_markets", {}], ["search_markets", { query: 42 }],
  ["get_market", {}], ["get_market", { market_id: "" }], ["get_market", { market_id: "x".repeat(101) }], ["get_market", { market_id: "does-not-exist" }],
  ["track_record", { unexpected: true }], ["my_list", { limit: -5 }], ["my_list", { page: 0 }],
  ["no_such_tool", {}],
];

let raw = [];
const recFetch = (url, init) => fetch(url, init).then(async (res) => {
  const body = await res.clone().text();
  raw.push(`${init?.method ?? "GET"} ${res.status} ${res.headers.get("content-type")} ${body.slice(0, 300).replace(/\s+/g, " ")}`);
  return res;
});

async function era(label, mode, user) {
  log(`\n== ${label}`);
  const client = new Client({ name: `audit4-${label}`, version: "1" }, mode ? { versionNegotiation: { mode } } : {});
  const transport = new StreamableHTTPClientTransport(new URL(`${W}/api/mcp`), { fetch: recFetch, requestInit: { headers: { authorization: `Bearer ${tok(user)}` } } });
  try { await client.connect(transport); } catch (e) { log(`connect failed: ${e}`); return; }
  log(`connected; server protocol=${client.getNegotiatedProtocolVersion?.() ?? transport.protocolVersion ?? "?"}`);
  for (const [name, args] of CASES) {
    raw = [];
    let r, err;
    try { r = await client.callTool({ name, arguments: args }); } catch (e) { err = e; }
    if (err) { log(`  ${name} ${JSON.stringify(args).slice(0, 60)} -> THROWN (protocol error, not a tool result): ${String(err.message ?? err).slice(0, 160)}`); continue; }
    const t = textOf(r);
    log(`  ${name} ${JSON.stringify(args).slice(0, 60)} -> isError=${!!r.isError} blocks=${r.content?.length} ${verdict(t)} | ${t.split("\n")[0].slice(0, 130)}`);
  }
  await client.close().catch(() => {});
}
await era("legacy 2025 (initialize handshake)", "legacy", premA);
await era("modern 2026-07-28 (pinned)", { pin: "2026-07-28" }, premB);

log("\n== raw HTTP variants (2025-06-18 header), limit 0");
const rpcRaw = async (headers, body) => {
  const r = await fetch(`${W}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok(premC)}`, "mcp-protocol-version": "2025-06-18", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, ctype: r.headers.get("content-type"), text: await r.text() };
};
const parse = (x) => { try { return JSON.parse(x.text); } catch { const d = x.text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5))); return d.length === 1 ? d[0] : d; } };
for (const [label, accept] of [["Accept json+sse", "application/json, text/event-stream"], ["Accept text/event-stream only", "text/event-stream"], ["Accept application/json only", "application/json"]]) {
  const x = await rpcRaw({ accept }, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "best_bets", arguments: { limit: 0 } } });
  let j; try { j = parse(x); } catch { j = null; }
  const t = j?.result ? textOf(j.result) : null;
  log(`  ${label}: http ${x.status} ${x.ctype} ${t ? verdict(t) : "no tool result: " + x.text.slice(0, 160)}`);
}
{
  const batch = [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "best_bets", arguments: { limit: 0 } } }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "best_bets", arguments: { limit: 1 } } }];
  const x = await rpcRaw({ accept: "application/json, text/event-stream" }, batch);
  log(`  batch [limit 0, limit 1]: http ${x.status} ${x.ctype} ${x.text.slice(0, 220).replace(/\s+/g, " ")}`);
}
{
  const x = await rpcRaw({ accept: "application/json, text/event-stream", authorization: `Bearer ${tok(free)}` }, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "best_bets", arguments: { limit: 0 } } });
  const j = parse(x); const t = j?.result ? textOf(j.result) : null;
  log(`  Free user, invalid input (limit 0): http ${x.status} ${t ? verdict(t) : x.text.slice(0, 160)} | ${t?.split("\n")[0].slice(0, 120)}`);
}

log("\n== MCP-b: Origin matrix (POST tools/list, valid Premium token)");
const site = new URL(W);
const MATRIX = [
  ["no Origin", {}], ["own Origin " + W, { origin: W }], ["own host, other port http://localhost:9999", { origin: "http://localhost:9999" }],
  ["own host, https scheme", { origin: `https://${site.host}` }], ["foreign http://evil.example", { origin: "http://evil.example" }],
  ["foreign https://kismetodds.com.evil.example", { origin: "https://kismetodds.com.evil.example" }], ["foreign https://evil.example.localhost", { origin: "https://evil.localhost.evil.example" }],
  ["Origin: null", { origin: "null" }], ["Origin: garbage", { origin: "not a url" }], ["127.0.0.1 (different hostname than localhost)", { origin: "http://127.0.0.1:3161" }],
  ["foreign Origin + spoofed Host evil.example (DNS-rebinding shape)", { origin: "http://evil.example", host: "evil.example" }],
  ["foreign Origin + X-Forwarded-Host evil.example", { origin: "http://evil.example", "x-forwarded-host": "evil.example" }],
];
for (const [label, h] of MATRIX) {
  const r = await fetch(`${W}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok(premC)}`, "mcp-protocol-version": "2025-06-18", ...h }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  const body = await r.text();
  log(`  ${label}: ${r.status} cache-control=${r.headers.get("cache-control")} ${body.slice(0, 110).replace(/\s+/g, " ")}`);
}
{
  const r = await fetch(`${W}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "http://evil.example" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  log(`  foreign Origin, no token: ${r.status} (403 before auth = Origin checked first) ${(await r.text()).slice(0, 100)}`);
}
fs.writeFileSync(process.env.OUT ?? "mcp-eras.txt", out.join("\n") + "\n");
console.log("DONE");
