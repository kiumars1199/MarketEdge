// T-276: an account is required. Signed out, only the public pages, files and APIs answer; every other page
// redirects to /signup?next=<page> (OAuth consent pages to /login), every other API route is a 401 JSON.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APP_PAGES, LOGIN_FIRST, PUBLIC_FILES, PUBLIC_PAGES, SELF_GUARDED, signedOutAccess } from "@/lib/auth/public-paths";

const q = (s: string) => new URLSearchParams(s);

describe("signedOutAccess (lib/auth/public-paths.ts)", () => {
  it("public pages, their sub-paths, files and discovery stay open", () => {
    for (const p of ["/", "/pricing", "/about", "/track-record", "/terms", "/privacy", "/refunds", "/disclaimer", "/contact",
      "/login", "/signup", "/reset-password", "/auth/callback", "/m/123", "/event/abc", "/status",
      "/robots.txt", "/sitemap.xml", "/llms.txt", "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/c.js", "/.well-known/oauth-authorization-server", "/icon.svg", "/opengraph-image", "/m/1/opengraph-image",
      "/_next/data/x.json"])
      expect(signedOutAccess(p), p).toBe("public");
  });

  it("the app pages need an account: sign-up, or log-in for the OAuth consent pages", () => {
    for (const p of ["/bets", "/markets", "/watchlist", "/journal", "/tools", "/tools/kelly", "/alerts", "/dashboards", "/settings",
      "/account", "/onboarding", "/combos", "/kalshi", "/ext/connect", "/bets/x", "/dashboards/abc"])
      expect(signedOutAccess(p), p).toBe("signup");
    expect(signedOutAccess("/oauth/authorize")).toBe("login");
    expect(signedOutAccess("/oauth")).toBe("login");
  });

  it("#33: a URL that is no page gets the 404 page signed out, not the sign-up wall", () => {
    for (const p of ["/pricingx", "/aboutus", "/m", "/mx/1", "/nope-xyz", "/some/deep/path", "/betsx", "/accounts"])
      expect(signedOutAccess(p), p).toBe("public");
  });

  it("every page folder in app/ is classified, so a new page can't go public by being forgotten (#33)", () => {
    const app = fileURLToPath(new URL("../app", import.meta.url));
    const routes = readdirSync(app, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !/^[_([.]/.test(d.name) && d.name !== "api")
      .map((d) => `/${d.name}`);
    const known = [...PUBLIC_PAGES, ...PUBLIC_FILES, ...APP_PAGES, ...LOGIN_FIRST, ...SELF_GUARDED, "/signed-in"];   // twins: 404 in middleware
    const missing = routes.filter((r) => !known.some((k) => r === k || r.startsWith(`${k}/`)));
    expect(missing, "add each to APP_PAGES (needs an account) or PUBLIC_PAGES in lib/auth/public-paths.ts").toEqual([]);
    for (const r of APP_PAGES) expect(signedOutAccess(r), r).toBe("signup");
  });

  it("/admin and the e2e mock guard themselves (404 to non-admins), so they aren't redirected", () => {
    expect(signedOutAccess("/admin")).toBe("public");
    expect(signedOutAccess("/admin/users")).toBe("public");
    expect(signedOutAccess("/e2e-mock/auth/v1/user")).toBe("public");
  });

  it("/ is the landing whatever the query; only a market deep link (?m=) needs an account", () => {
    expect(signedOutAccess("/", q("utm_source=x&gclid=1&ref=hn"))).toBe("public");
    expect(signedOutAccess("/", q("deleted=1"))).toBe("public");
    expect(signedOutAccess("/", q("m=123"))).toBe("signup");
    expect(signedOutAccess("/", q("srsltid=a&msclkid=b&_gl=c&cat=sports"))).toBe("public");   // unknown tags: still the landing
  });

  it("API: only the listed routes are public; everything else is api401", () => {
    for (const p of ["/api/health", "/api/meta", "/api/me", "/api/backtest", "/api/auth/password", "/api/auth/google", "/api/stripe/webhook",
      "/api/unsubscribe", "/api/alerts/run", "/api/settle/run", "/api/ext/token/refresh", "/api/events/by-slug/x", "/api/mcp", "/api/mcp/sse"])
      expect(signedOutAccess(p), p).toBe("public");
    for (const p of ["/api/flags", "/api/markets", "/api/markets/1", "/api/events/1", "/api/suggest", "/api/book", "/api/data",
      "/api/stripe/checkout", "/api/stripe/portal", "/api/ext/token", "/api/admin", "/api/healthz", "/api/mcpx", "/api"])
      expect(signedOutAccess(p), p).toBe("api401");
  });
});

describe("middleware account wall", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("@supabase/ssr"); });

  async function mw(user: { email: string; email_confirmed_at: string } | null, { keys = true, demo = false } = {}) {
    if (keys) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    }
    vi.stubEnv("DEMO_MODE", demo ? "true" : "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", demo ? "true" : "false");
    vi.doMock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: null } }) } }) }));
    vi.doMock("@/lib/maintenance", () => ({ maintenanceOn: async () => false }));
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    return (path: string, method = "GET") => middleware(new NextRequest(`https://kismet.test${path}`, { method }));
  }

  it("signed out: app pages redirect to /signup with the page (and query) as next", async () => {
    const hit = await mw(null);
    for (const [path, next] of [["/bets", "/bets"], ["/markets?cat=sports&sort=edge", "/markets?cat=sports&sort=edge"], ["/account", "/account"], ["/?m=123", "/?m=123"]]) {
      const res = await hit(path);
      expect(res.status, path).toBe(307);
      const to = new URL(res.headers.get("location")!);
      expect(to.origin).toBe("https://kismet.test");
      expect(to.pathname).toBe("/signup");
      expect(to.searchParams.get("next")).toBe(next);
      expect([...to.searchParams.keys()]).toEqual(["next"]);   // nothing else from the original query leaks into /signup
    }
  });

  it("signed out: /oauth/* goes to /login, keeping the full consent URL as next", async () => {
    const res = await (await mw(null))("/oauth/authorize?client_id=c&redirect_uri=https%3A%2F%2Fx.test%2Fcb&state=s");
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/oauth/authorize?client_id=c&redirect_uri=https%3A%2F%2Fx.test%2Fcb&state=s");
  });

  it("signed out: API routes outside the list are 401 JSON, not cacheable; listed ones and preflights pass", async () => {
    const hit = await mw(null);
    for (const p of ["/api/flags", "/api/markets/1", "/api/suggest?q=x", "/api/data"]) {
      for (const m of ["GET", "POST"]) {
        const res = await hit(p, m);
        expect(res.status, `${m} ${p}`).toBe(401);
        expect(res.headers.get("cache-control")).toMatch(/no-store/);
        expect(await res.json()).toEqual({ error: "Sign in to use this.", signin: "/login" });
      }
    }
    for (const p of ["/api/health", "/api/meta", "/api/me", "/api/auth/password", "/api/events/by-slug/x", "/api/mcp"])
      expect((await hit(p)).status, p).toBe(200);   // NextResponse.next()
    expect((await hit("/api/flags", "OPTIONS")).status).toBe(200);
  });

  it("signed out: public pages pass", async () => {
    const hit = await mw(null);
    for (const p of ["/", "/pricing", "/about", "/track-record", "/signup?next=/bets", "/login", "/m/123", "/event/x", "/llms.txt", "/.well-known/openid-configuration"])
      expect((await hit(p)).status, p).toBe(200);
  });

  it("signed in: nothing is walled", async () => {
    const hit = await mw({ email: "u@example.com", email_confirmed_at: "x" });
    for (const p of ["/bets", "/markets?cat=sports", "/account", "/?m=1", "/api/flags", "/oauth/authorize"]) expect((await hit(p)).status, p).toBe(200);
  });

  it("demo mode and builds without accounts have no wall", async () => {
    expect((await (await mw(null, { demo: true }))("/bets")).status).toBe(200);
    vi.unstubAllEnvs();
    vi.resetModules();
    expect((await (await mw(null, { keys: false }))("/api/flags")).status).toBe(200);
  });
});

describe("/api/events/by-slug: open CORS for the extension, but needs a session or an extension token", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("@/lib/auth/server"); });

  async function route(user: { id: string; email: string } | null) {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("EXT_SIGNING_SECRET", "x".repeat(40));
    vi.doMock("@/lib/auth/server", async (orig) => ({
      ...(await orig<typeof import("@/lib/auth/server")>()),
      authEnabled: () => true,
      getUser: async () => (user ? { ...user, verified: true } : null),
      getMe: async () => ({ user, tier: "free", status: null, current_period_end: null, cancel_at_period_end: false, beta: false }),
    }));
    const { GET } = await import("@/app/api/events/by-slug/[slug]/route");
    const { issueExtToken } = await import("@/lib/trade/server");
    return { GET, issueExtToken };
  }
  const call = (GET: (r: Request, c: { params: Promise<{ slug: string }> }) => Promise<Response>, auth?: string) =>
    GET(new Request("https://kismet.test/api/events/by-slug/none", { headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ slug: "none" }) });

  it("no session, no token: 401 with CORS headers", async () => {
    const { GET } = await route(null);
    const res = await call(GET);
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await call(GET, "Bearer forged.token")).toHaveProperty("status", 401);
  });

  it("a valid extension token, or a session, gets through (404 for an unknown slug)", async () => {
    const { GET, issueExtToken } = await route(null);
    const t = issueExtToken({ id: "u1", email: "u@x.test" }, "free")!;
    expect((await call(GET, `Bearer ${t.token}`)).status).toBe(404);
    vi.resetModules();
    const signedIn = await route({ id: "u1", email: "u@x.test" });
    expect((await call(signedIn.GET)).status).toBe(404);
  });
});
