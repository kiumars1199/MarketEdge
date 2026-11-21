// Run 4 (bd21cc6 delta): failed-token budget on /api/mcp, black-box against the wired production build.
// usage: TOKEN=<valid premium app token> node mcp-badtoken.mjs > out
const W = process.env.W ?? "http://localhost:3161", GOOD = process.env.TOKEN;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const junk = (i) => `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, client_id: "x", exp: 9999999999 })}.mock`;
const call = async (tok, extra = {}) => {
  const t0 = Date.now();
  const r = await fetch(`${W}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const body = await r.text();
  return { s: r.status, ra: r.headers.get("retry-after"), www: r.headers.get("www-authenticate"), cc: r.headers.get("cache-control"), ms: Date.now() - t0, body: body.slice(0, 140).replace(/\s+/g, " ") };
};
const tally = (xs) => Object.entries(xs.reduce((m, x) => ((m[x.s] = (m[x.s] ?? 0) + 1), m), {})).map(([k, v]) => `${k}x${v}`).join(" ");
const log = (...a) => console.log(...a);
log(`# ${W} ${new Date().toISOString()} (off Vercel: clientKey = "ip:local" for every caller)`);
let xs = []; for (let i = 0; i < 40; i++) xs.push(await call(GOOD)); log(`1. 40 valid Premium tokens: ${tally(xs)}`);
xs = []; for (let i = 0; i < 5; i++) xs.push(await call(null)); log(`2. 5 with no Authorization: ${tally(xs)} www=${xs[0].www}`);
xs = []; for (let i = 0; i < 30; i++) xs.push(await call(junk(i))); log(`3. 30 rejected tokens: ${tally(xs)} | first: ${xs[0].body} | www=${xs[0].www?.slice(0, 120)}`);
let x = await call(junk(30)); log(`4. 31st rejected token: ${x.s} ${x.body}`);
x = await call(junk(31)); log(`5. 32nd rejected token: ${x.s} retry-after=${x.ra} cache-control=${x.cc} ${x.ms}ms ${x.body}`);
x = await call(GOOD); log(`6. VALID Premium token while the client key is blocked: ${x.s} retry-after=${x.ra} ${x.body}`);
x = await call(null); log(`7. no token while blocked: ${x.s} ${x.body}`);
x = await call(GOOD, { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" }); log(`8. valid token + spoofed X-Forwarded-For/X-Real-IP while blocked: ${x.s}`);
const wait = Number(x.ra ?? 60) + 2; log(`   waiting ${wait}s for the block to lapse`);
await new Promise((r) => setTimeout(r, wait * 1000));
x = await call(GOOD); log(`9. valid token after Retry-After: ${x.s}`);
x = await call(junk(99)); log(`10. one more rejected token after lapse: ${x.s} (limiter window is a fixed/sliding 1 m; this shows whether the block re-trips at once)`);
x = await call(GOOD); log(`11. valid token after that: ${x.s}`);
