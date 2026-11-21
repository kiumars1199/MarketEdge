// Run 4 (bd21cc6): can routine token expiry trip the failed-token block? 31 tokens for REAL users that expired 60 s ago
// (what an assistant sends before it refreshes), then a valid token. Off Vercel every caller shares clientKey "ip:local".
const W = "http://localhost:3161", SB = "http://localhost:3160/e2e-mock/supabase", RUN = Date.now();
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (c) => `${b64u({ alg: "none", typ: "JWT" })}.${b64u(c)}.mock`;
const now = () => Math.floor(Date.now() / 1000);
async function seed(email) {
  await fetch(`${SB}/auth/v1/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const { url } = await (await fetch(`${SB}/_inbox?email=${encodeURIComponent(email)}`)).json();
  const s = await (await fetch(`${SB}/auth/v1/token?grant_type=pkce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auth_code: new URL(url).searchParams.get("code") }) })).json();
  await fetch(`${SB}/rest/v1/subscriptions?user_id=eq.${s.user.id}`, { method: "PATCH", headers: { apikey: "e2e-service", authorization: "Bearer e2e-service", "content-type": "application/json" }, body: JSON.stringify({ tier: "premium", status: "active" }) });
  return s.user;
}
const call = async (tok) => { const r = await fetch(`${W}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }); return { s: r.status, www: r.headers.get("www-authenticate") ?? "", b: (await r.text()).slice(0, 100) }; };
const users = []; for (let i = 0; i < 32; i++) users.push(await seed(`audit4-exp-${i}-${RUN}@example.com`));
const good = users.pop();
const goodTok = jwt({ sub: good.id, email: good.email, role: "authenticated", exp: now() + 3600, client_id: "client-claude" });
console.log(`seeded 32 real Premium users; valid token for user 32 before: ${(await call(goodTok)).s}`);
const res = []; for (const u of users) res.push(await call(jwt({ sub: u.id, email: u.email, role: "authenticated", exp: now() - 60, client_id: "client-claude" })));
console.log(`31 expired-but-genuine tokens (31 different real users, exp 60 s ago): statuses ${[...new Set(res.map((x) => x.s))]} | ${res[0].www.slice(0, 90)}`);
const after = await call(goodTok);
console.log(`valid Premium token for a 32nd user right after: ${after.s} ${after.b}`);
