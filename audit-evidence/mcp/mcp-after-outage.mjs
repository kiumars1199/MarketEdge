// step 4 of mcp-outage.sh: after the mock restarts (state wiped), seed one Premium user and call /api/mcp.
const W = "http://localhost:3161", SB = "http://localhost:3160/e2e-mock/supabase";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const email = `audit4-after-outage-${Date.now()}@example.com`;
await fetch(`${SB}/auth/v1/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
const { url } = await (await fetch(`${SB}/_inbox?email=${encodeURIComponent(email)}`)).json();
const s = await (await fetch(`${SB}/auth/v1/token?grant_type=pkce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auth_code: new URL(url).searchParams.get("code") }) })).json();
await fetch(`${SB}/rest/v1/subscriptions?user_id=eq.${s.user.id}`, { method: "PATCH", headers: { apikey: "e2e-service", authorization: "Bearer e2e-service", "content-type": "application/json" }, body: JSON.stringify({ tier: "premium", status: "active" }) });
const tok = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: s.user.id, email, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, client_id: "c" })}.mock`;
const r = await fetch(`${W}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
console.log(`4. fresh Premium user after the outage: ${r.status} (200 = the 35+ outage answers did not count against the failed-token budget)`);
