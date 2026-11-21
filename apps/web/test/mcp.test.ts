// T-280: the Kismet MCP server (/api/mcp). Auth (401 + WWW-Authenticate), protected resource metadata, plan gates
// (Free none, Pro 3 a day, Premium 60 a minute), beta-only data, limits, disclaimer, my_list order, and parity with
// the web API for the same user. Vitest runs in DEMO_MODE, so the plan comes from the mocked getMeForUser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Tier } from "@/lib/entitlements";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "mcp@example.test", verified: true };
const h = vi.hoisted(() => ({
  tier: "premium" as Tier, beta: false, planFails: false,
  list: [] as { market_id: string; side_index: number; created_at: string }[],
  queries: [] as string[],
}));

vi.mock("@/lib/auth/server", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/server")>();
  const me = (user: typeof USER | null) => ({ user, tier: h.tier, status: null, current_period_end: null, cancel_at_period_end: false, beta: h.beta });
  // Fake service-role client: only the watchlist read my_list makes. Records the query so the test sees its order.
  const admin = {
    from: (t: string) => {
      const q = { t, eq: [] as unknown[], order: [] as unknown[] };
      const chain = {
        select: () => chain,
        eq: (k: string, v: string) => (q.eq.push([k, v]), chain),
        order: (k: string, o: { ascending: boolean }) => (q.order.push([k, o.ascending]), chain),
        range: async (a: number, b: number) => {
          h.queries.push(JSON.stringify({ ...q, range: [a, b] }));
          const mine = q.eq.some((e) => JSON.stringify(e) === JSON.stringify(["user_id", USER.id]));
          return { data: mine ? h.list.slice(a, b + 1) : [], error: null };
        },
      };
      return chain;
    },
  };
  return {
    ...real,
    getMe: async () => me(USER),
    getTier: async () => h.tier,
    getMeForUser: async (u: typeof USER) => {
      if (h.planFails) throw new Error("db down");
      return me(u);
    },
    supabaseAdmin: () => admin,
  };
});

const { POST, GET } = await import("@/app/api/mcp/route");
const { _setVerifier, _resetBadTokenBlocks, resourceMetadata, mcpMetadataUrl } = await import("@/lib/mcp/auth");
const { FREE_REFUSAL, PRO_USED_UP, MAX_LIMIT } = await import("@/lib/mcp/server");
const { memoryLimiter, setLimiter } = await import("@/lib/abuse");
const { getStore } = await import("@/lib/data/store");
const { DISCLAIMER } = await import("@/components/shell/Footer");
const flagsRoute = (await import("@/app/api/flags/route")).GET;
const { FilterState, BEST_BETS_VERDICTS } = await import("@/lib/filters/state");
const { serialize } = await import("@/lib/filters/url");

const ORIGIN = "http://localhost:3000";
const verifier = {
  async verifyAccessToken(token: string) {
    if (token !== "good") throw new OAuthError(OAuthErrorCode.InvalidToken, "bad token");
    return { token, clientId: "client-1", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { user: USER } };
  },
};

beforeEach(() => {
  _setVerifier(verifier);
  _resetBadTokenBlocks();
  setLimiter(memoryLimiter());
  Object.assign(h, { tier: "premium", beta: false, planFails: false, list: [], queries: [] });
});
afterEach(() => {
  _setVerifier(null);
  setLimiter(undefined);
});

const rpcReq = (body: unknown, token: string | null = "good") =>
  new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

/** A 2025-era JSON-RPC exchange (stateless): the body as JSON whether the server answered JSON or SSE. */
async function rpc(method: string, params: unknown = {}, token: string | null = "good") {
  const res = await POST(rpcReq({ jsonrpc: "2.0", id: 1, method, params }, token));
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join(""))
    : JSON.parse(text);
  return { res, json };
}
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (name: string, args: Record<string, unknown> = {}) => (await rpc("tools/call", { name, arguments: args })).json.result as ToolResult;
const text = (r: ToolResult) => r.content.map((c) => c.text).join("\n");

describe("auth (T-280)", () => {
  it("401 with a WWW-Authenticate resource_metadata challenge without a token, and with a bad token", async () => {
    for (const token of [null, "nope"]) {
      const res = await POST(rpcReq({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, token));
      expect(res.status, String(token)).toBe(401);
      const www = res.headers.get("www-authenticate") ?? "";
      expect(www).toMatch(/^Bearer /);
      expect(www).toContain(`resource_metadata="${mcpMetadataUrl()}"`);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
    expect((await GET(new Request(`${ORIGIN}/api/mcp`))).status).toBe(401);
  });

  it("SDK-written results (bad arguments, unknown tool) also end with the disclaimer", async () => {
    for (const params of [{ name: "best_bets", arguments: { limit: "lots", tier: 7 } }, { name: "place_bet", arguments: {} }]) {
      const { json } = await rpc("tools/call", params);
      const r = (json.result ?? null) as ToolResult | null;
      if (r) expect(text(r).endsWith(DISCLAIMER), params.name).toBe(true);
      else expect(json.error, params.name).toBeTruthy();   // a protocol error, not a result: nothing to append to
    }
  });

  it("rejected tokens: 30 a minute per client, then 429 without asking Supabase; good tokens and no-token don't count", async () => {
    const seen = vi.fn();
    _setVerifier({ async verifyAccessToken(t: string) { seen(t); return verifier.verifyAccessToken(t); } });
    const req = (t: string | null) => POST(rpcReq({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, t));
    for (let i = 0; i < 40; i++) expect((await req("good")).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await req(null)).status).toBe(401);
    for (let i = 0; i < 30; i++) expect((await req(`junk${i}`)).status).toBe(401);
    expect((await req("junk-over")).status).toBe(401);   // the 31st failure trips the block
    seen.mockClear();
    const blocked = await req("junk-more");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(seen).not.toHaveBeenCalled();
  });

  it("MCP-c: expired, malformed and site-session tokens are refused locally and never block the client", async () => {
    const { supabaseVerifier } = await import("@/lib/mcp/auth");
    _setVerifier({ verifyAccessToken: (t: string) => (t === "good" ? verifier.verifyAccessToken(t) : supabaseVerifier.verifyAccessToken(t)) });
    const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    const past = Math.floor(Date.now() / 1000) - 60;
    const req = (t: string) => POST(rpcReq({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, t));
    for (let i = 0; i < 40; i++) expect((await req(jwt({ sub: `u${i}`, client_id: "c1", exp: past }))).status).toBe(401);
    for (let i = 0; i < 40; i++) expect((await req(`junk${i}`)).status).toBe(401);
    for (let i = 0; i < 40; i++) expect((await req(jwt({ sub: `u${i}`, exp: past + 3600 }))).status).toBe(401);
    expect((await req("good")).status).toBe(200);   // a first-time valid token: the client isn't blocked
  });

  it("MCP-c: once a client is blocked for tokens Supabase rejected, tokens it verified recently still pass", async () => {
    const req = (t: string) => POST(rpcReq({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, t));
    expect((await req("good")).status).toBe(200);
    for (let i = 0; i < 31; i++) expect((await req(`forged${i}`)).status).toBe(401);
    expect((await req("forged-more")).status).toBe(429);
    expect((await req("good")).status).toBe(200);
  });

  it("refuses everything when accounts are off and no verifier is forced (demo mode never opens the endpoint)", async () => {
    _setVerifier(null);
    const res = await POST(rpcReq({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    expect(res.status).toBe(401);
  });

  it("protected resource metadata: resource = the exact connector URL, Supabase as the only authorization server", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    const m = resourceMetadata();
    expect(m.authorization_servers).toEqual(["https://proj.supabase.co/auth/v1"]);
    expect(m.resource).toMatch(/\/api\/mcp$/);
    expect(m.resource).toBe(mcpMetadataUrl().replace("/.well-known/oauth-protected-resource", ""));
    expect(m.authorization_servers).toHaveLength(1);
    expect(m.authorization_servers[0]).toMatch(/\/auth\/v1$/);
    expect(m.bearer_methods_supported).toEqual(["header"]);
    expect(m).not.toHaveProperty("scopes_supported");   // no openid until asymmetric keys (owner step)
    for (const path of ["@/app/.well-known/oauth-protected-resource/route", "@/app/.well-known/oauth-protected-resource/api/mcp/route"]) {
      const res = (await import(path)).GET() as Response;
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toEqual(m);
    }
    vi.unstubAllEnvs();
  });

  it("protected resource metadata is 404 when no Supabase project is configured (no authorization server)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    try {
      const res = (await import("@/app/.well-known/oauth-protected-resource/api/mcp/route")).GET() as Response;
      expect(res.status).toBe(404);
    } finally { vi.unstubAllEnvs(); }
  });

  it("the real verifier accepts only OAuth-client tokens whose subject is the verified user", async () => {
    vi.resetModules();
    const getUser = vi.fn(async () => ({ data: { user: { id: USER.id, email: USER.email, email_confirmed_at: "x" } }, error: null }));
    vi.doMock("@supabase/supabase-js", async (o) => ({ ...(await o<object>()), createClient: () => ({ auth: { getUser } }) }));
    const { supabaseVerifier } = await import("@/lib/mcp/auth");
    const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    const exp = Math.floor(Date.now() / 1000) + 600;
    const ok = await supabaseVerifier.verifyAccessToken(jwt({ sub: USER.id, client_id: "c1", exp }));
    expect(ok).toMatchObject({ clientId: "c1", expiresAt: exp, extra: { user: { id: USER.id } } });
    await expect(supabaseVerifier.verifyAccessToken(jwt({ sub: USER.id, exp }))).rejects.toThrow(/OAuth/);   // site session token
    const calls = getUser.mock.calls.length;
    await expect(supabaseVerifier.verifyAccessToken(jwt({ sub: USER.id, client_id: "c1", exp: 1 }))).rejects.toThrow(/expired/);
    await expect(supabaseVerifier.verifyAccessToken("not-a-jwt")).rejects.toThrow(/Malformed/);
    expect(getUser.mock.calls.length).toBe(calls);   // refused locally: Supabase not asked
    await expect(supabaseVerifier.verifyAccessToken(jwt({ sub: "someone-else", client_id: "c1", exp }))).rejects.toThrow(/subject/);
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 403, message: "bad jwt" } } as never);
    await expect(supabaseVerifier.verifyAccessToken(jwt({ sub: USER.id, client_id: "c1", exp }))).rejects.toMatchObject({ code: "invalid_token" });
    // Supabase down (supabase-js: AuthRetryableFetchError, status 0), 5xx, or a throw: an outage, not a bad token.
    for (const fail of [
      () => getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } } as never),
      () => getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 503, message: "down" } } as never),
      () => getUser.mockRejectedValueOnce(new TypeError("fetch failed")),
      () => getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 429, message: "slow down" } } as never),
      () => getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 408, message: "timeout" } } as never),
    ]) {
      fail();
      await expect(supabaseVerifier.verifyAccessToken(jwt({ sub: USER.id, client_id: "c1", exp }))).rejects.toMatchObject({ code: "server_error" });
    }
    vi.doUnmock("@supabase/supabase-js");
    vi.resetModules();
  });
});

describe("protocol", () => {
  it("2025-era initialize and tools/list over plain JSON-RPC; every tool read-only", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } });
    expect(init.res.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe("kismet");
    const { json } = await rpc("tools/list");
    const tools = json.result.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["best_bets", "get_market", "my_list", "search_markets", "track_record"]);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("a real MCP client connects, lists tools and calls one (fetch wired to the route)", async () => {
    const fetchRoute = async (url: string | URL, init?: RequestInit) => {
      const req = new Request(url, init);
      return req.method === "POST" ? POST(req) : GET(req);
    };
    const client = new Client({ name: "vitest", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
      fetch: fetchRoute as typeof fetch, requestInit: { headers: { authorization: "Bearer good" } },
    });
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(5);
    const r = (await client.callTool({ name: "track_record", arguments: {} })) as ToolResult;
    expect(r.isError).toBeFalsy();
    expect(text(r).endsWith(DISCLAIMER)).toBe(true);
    await client.close();
  });

  it("the modern protocol era (2026-07-28 pinned) also gets the bearer user into tool calls", async () => {
    const fetchRoute = async (url: string | URL, init?: RequestInit) => {
      const req = new Request(url, init);
      return req.method === "POST" ? POST(req) : GET(req);
    };
    const client = new Client({ name: "vitest-modern", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
      fetch: fetchRoute as typeof fetch, requestInit: { headers: { authorization: "Bearer good" } },
    });
    await client.connect(transport);
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    expect((await client.listTools()).tools).toHaveLength(5);
    h.tier = "free";   // proves the plan gate (and so authInfo) runs on this leg too
    const r = (await client.callTool({ name: "track_record", arguments: {} })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(FREE_REFUSAL());
    h.tier = "premium";
    const ok = (await client.callTool({ name: "track_record", arguments: {} })) as ToolResult;
    expect(ok.isError).toBeFalsy();
    await client.close();
  });

  it("tools/list stays open to a Free token (gating is per call)", async () => {
    h.tier = "free";
    const { res, json } = await rpc("tools/list");
    expect(res.status).toBe(200);
    expect(json.result.tools).toHaveLength(5);
  });
});

describe("plan gates", () => {
  it("Free: refused with the upgrade message and the pricing link, no data", async () => {
    h.tier = "free";
    for (const name of ["best_bets", "search_markets", "get_market", "track_record", "my_list"]) {
      const r = await call(name, name === "search_markets" ? { query: "a" } : name === "get_market" ? { market_id: "x" } : {});
      expect(r.isError, name).toBe(true);
      expect(text(r)).toContain(FREE_REFUSAL());
      expect(text(r)).toMatch(/\/pricing/);
      expect(text(r)).not.toMatch(/Bet .* at \d/);
    }
  });

  it("Pro: 3 calls a day, then the upgrade message", async () => {
    h.tier = "pro";
    for (let i = 0; i < 3; i++) expect((await call("track_record")).isError, `call ${i + 1}`).toBeFalsy();
    const r = await call("best_bets");
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(PRO_USED_UP());
    expect(text(r)).toMatch(/\/pricing/);
  });

  it("Premium: 60 calls a minute, then a slow-down message", async () => {
    for (let i = 0; i < 60; i++) expect((await call("track_record")).isError, `call ${i + 1}`).toBeFalsy();
    const r = await call("track_record");
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/60 a minute/);
  });

  it("a plan lookup failure is refused, never treated as a paid plan", async () => {
    h.planFails = true;
    const r = await call("best_bets");
    expect(r.isError).toBe(true);
    expect(text(r)).not.toMatch(/Bet .* at \d/);
  });
});

describe("audit run 3 (MCP-a, MCP-b)", () => {
  const withOrigin = (origin: string) => {
    const r = rpcReq({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const headers = new Headers(r.headers);
    headers.set("origin", origin);
    return new Request(r.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  };

  it("403 for a browser Origin that isn't Kismet's, even with a valid token; own origin and no Origin pass", async () => {
    const bad = await POST(withOrigin("http://evil.example"));
    expect(bad.status).toBe(403);
    expect(bad.headers.get("cache-control")).toContain("no-store");
    expect((await POST(withOrigin(ORIGIN))).status).toBe(200);
    expect((await rpc("tools/list")).res.status).toBe(200);
  });

  it("MCP_ALLOWED_ORIGINS adds hostnames", async () => {
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "inspector.example");
    expect((await POST(withOrigin("https://inspector.example"))).status).toBe(200);
    vi.unstubAllEnvs();
  });

  it("modern protocol (2026-07-28): input the SDK rejects still ends with the disclaimer", async () => {
    const fetchRoute = async (url: string | URL, init?: RequestInit) => {
      const req = new Request(url, init);
      return req.method === "POST" ? POST(req) : GET(req);
    };
    const client = new Client({ name: "vitest-modern", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
      fetch: fetchRoute as typeof fetch, requestInit: { headers: { authorization: "Bearer good" } },
    });
    await client.connect(transport);
    const r = (await client.callTool({ name: "best_bets", arguments: { limit: 0 } })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(text(r).endsWith(DISCLAIMER)).toBe(true);
    await client.close();
  });

  it("input the SDK rejects (limit 0) still ends with the disclaimer", async () => {
    const raw = await rpc("tools/call", { name: "best_bets", arguments: { limit: 0 } });
    const r = raw.json.result as ToolResult;
    expect(r.isError).toBe(true);
    expect(text(r).endsWith(DISCLAIMER)).toBe(true);
  });
});

describe("tools", () => {
  it("best_bets: limit clamped to 25, filters apply, every result shows its basis and ends with the disclaimer", async () => {
    const r = await call("best_bets", { limit: 500, tier: "all" });
    const t = text(r);
    expect(r.isError).toBeFalsy();
    const shown = t.match(/^\d+\. /gm) ?? [];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(MAX_LIMIT);
    expect(t).toMatch(/showing 1–\d+/);
    expect((t.match(/Basis: Model: /g) ?? []).length).toBe(shown.length);
    expect(t.endsWith(DISCLAIMER)).toBe(true);

    const store = await getStore();
    const cat = store.flags[0]!.category;
    const only = text(await call("best_bets", { categories: [cat], tier: "all", limit: 25 }));
    const cats = [...only.matchAll(/ · ([a-z]+)\n {3}Basis/g)].map((m) => m[1]);
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats)).toEqual(new Set([cat]));

    const pays = text(await call("best_bets", { pays_min: 3, tier: "all", limit: 25 }));
    for (const m of pays.matchAll(/pays (\d+(?:\.\d)?)x/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(2.95);
  });

  it("best_bets equals /api/flags for the same user and filters (no more than the web gives)", async () => {
    for (const tier of ["pro", "premium"] as const) {
      h.tier = tier;
      setLimiter(memoryLimiter());
      const f = FilterState.parse({ view: "flags", verdicts: BEST_BETS_VERDICTS, group_by_event: false, tier: "best", page: 1, page_size: 10 });
      const web = (await (await flagsRoute(new Request(`${ORIGIN}/api/flags?${serialize(f)}`))).json()) as { rows: { market: { id: string; question: string }; side: { ask: number } }[] };
      const t = text(await call("best_bets", { limit: 10 }));
      const urls = [...t.matchAll(/\/m\/([^\s]+)/g)].map((m) => decodeURIComponent(m[1]!));
      expect(urls, tier).toEqual(web.rows.map((r) => r.market.id));
    }
  });

  it("get_market: verdict, price check, sample size, model level and the backtest basis", async () => {
    const store = await getStore();
    const m = store.flags.find((x) => x.execution)!;
    const t = text(await call("get_market", { market_id: `https://kismetodds.com/m/${m.id}` }));
    expect(t).toContain(m.question);
    expect(t).toContain(`Verdict: ${m.execution!.verdict}`);
    expect(t).toMatch(/Price check \(cost of crossing the spread, after the fee\)/);
    expect(t).toMatch(/Model level: [a-z +]+ · sample: [\d.,K]+ effective past bets/);
    expect(t).toMatch(/Backtest basis: /);
    expect(t.endsWith(DISCLAIMER)).toBe(true);
    const missing = await call("get_market", { market_id: "does-not-exist" });
    expect(missing.isError).toBe(true);
    expect(text(missing).endsWith(DISCLAIMER)).toBe(true);
  });

  it("Kalshi venue shows only with KALSHI_DATA_PERMISSION=true (live for every plan since Nov 21)", async () => {
    const store = await getStore();
    const m = store.flags.find((x) => x.execution)!;
    const before = m.kalshi_ticker;
    m.kalshi_ticker = "KXTEST-1";
    try {
      vi.stubEnv("KALSHI_DATA_PERMISSION", "");
      expect(text(await call("get_market", { market_id: m.id }))).not.toMatch(/Kalshi|KXTEST/);
      vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
      expect(text(await call("get_market", { market_id: m.id }))).toMatch(/Kalshi \(KXTEST-1\)/);
    } finally {
      vi.unstubAllEnvs();
      m.kalshi_ticker = before;
    }
  });

  it("search_markets and track_record answer with basis and the disclaimer", async () => {
    const store = await getStore();
    const word = store.markets[0]!.question.split(/\s+/).find((w) => w.length > 4)!;
    const s = text(await call("search_markets", { query: word, limit: 3 }));
    expect(s).toMatch(/markets match/);
    expect(s.endsWith(DISCLAIMER)).toBe(true);
    const tr = text(await call("track_record"));
    expect(tr).toMatch(/Best bets tested/);
    expect(tr).toMatch(/every bet, no filter/);
    expect(tr.endsWith(DISCLAIMER)).toBe(true);
  });

  it("my_list: the user's own rows in saved order, never re-ranked, public verdicts", async () => {
    const store = await getStore();
    // saved in this order: the lowest-return flag first, so any ranking by return would reorder them
    const picked = [...store.flags].sort((a, b) => a.best.roi_pct - b.best.roi_pct).slice(0, 4);
    h.list = picked.map((m, i) => ({ market_id: m.id, side_index: m.best.side_index, created_at: `2026-11-0${i + 1}T00:00:00Z` }));
    const t = text(await call("my_list"));
    const ids = [...t.matchAll(/\/m\/([^\s]+)/g)].map((m) => decodeURIComponent(m[1]!));
    expect(ids).toEqual(picked.map((m) => m.id));
    expect(t).toMatch(/in the order you saved them/);
    expect(t.endsWith(DISCLAIMER)).toBe(true);
    const q = JSON.parse(h.queries.at(-1)!);
    expect(q).toMatchObject({ t: "watchlist", eq: [["user_id", USER.id]], order: [["created_at", true]] });
    expect(q.range[1] - q.range[0] + 1).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it("no tool text uses pick / lock / guaranteed / sure thing / can't lose", async () => {
    const { json } = await rpc("tools/list");
    const all = [JSON.stringify(json), text(await call("best_bets", { tier: "all" })), text(await call("track_record")), FREE_REFUSAL(), PRO_USED_UP()].join("\n");
    expect(all).not.toMatch(/\b(picks?|locks?|guaranteed|sure thing|can't lose|can’t lose)\b/i);
  });
});
