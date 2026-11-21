// T-280: tokens Supabase's OAuth server issues to apps (client_id claim) are for /api/mcp only. Replayed as a site
// session cookie they are signed out everywhere: middleware, getUser/getMe (admin and plan) and withUser (/api/data,
// account delete and export).
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAppToken } from "@/lib/auth/app-token";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const APP = jwt({ sub: "u1", role: "authenticated", client_id: "9f0c", exp: 9e9 });
const SITE = jwt({ sub: "u1", role: "authenticated", session_id: "s", exp: 9e9 });
const admin = { id: "u1", email: "boss@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" };

function supabaseWith(token: string) {
  return {
    auth: { getUser: async () => ({ data: { user: admin } }), getSession: async () => ({ data: { session: { access_token: token } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tier: "premium" } }) }) }) }),
  };
}

function setup(token: string) {
  vi.resetModules();
  vi.doMock("@/lib/config", async (o) => ({ ...(await o<object>()), DEMO_MODE: false }));
  vi.doMock("@supabase/ssr", () => ({ createServerClient: () => supabaseWith(token) }));
  vi.doMock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
  vi.doMock("@/lib/maintenance", () => ({ maintenanceOn: async () => false }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("ADMIN_EMAILS", "boss@x.test");
}

describe("OAuth app tokens are not site sessions (T-280)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const m of ["@/lib/config", "@supabase/ssr", "next/headers", "@/lib/maintenance"]) vi.doUnmock(m);
    vi.resetModules();
  });

  it("isAppToken reads the client_id claim; unreadable fails closed", () => {
    expect(isAppToken(APP)).toBe(true);
    expect(isAppToken(SITE)).toBe(false);
    expect(isAppToken(undefined)).toBe(false);
    expect(isAppToken("a.%%%.c")).toBe(true);
  });

  it("getUser / getMe: an app token is signed out, even for an admin email (no admin, no plan)", async () => {
    setup(APP);
    const { getUser, getMe } = await import("@/lib/auth/server");
    expect(await getUser()).toBeNull();
    expect(await getMe()).toMatchObject({ user: null, tier: "free", beta: false });
    setup(SITE);
    const s = await import("@/lib/auth/server");
    expect(await s.getUser()).toMatchObject({ id: "u1" });
    expect((await s.getMe()).tier).toBe("premium");
  });

  it("withUser (/api/data, account delete and export) answers 401", async () => {
    setup(APP);
    const { withUser } = await import("@/lib/repo/server");
    const res = await withUser(new Request("https://kismet.test/api/data"), async () => new Response("ran"));
    expect(res.status).toBe(401);
  });

  it("middleware: walled pages redirect and /api/admin is 404, as for a signed-out visitor", async () => {
    setup(APP);
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    const hit = (p: string) => middleware(new NextRequest(`https://kismet.test${p}`));
    expect((await hit("/account")).status).toBe(307);
    expect((await hit("/api/admin/users")).status).toBe(404);
    expect((await hit("/api/flags")).status).toBe(401);
  });

  it("the consent page survives every sign-in path's next= (magic link, password, Google, onboarding)", async () => {
    const { safeNext } = await import("@/lib/auth/server");
    const consent = "/oauth/consent?authorization_id=Ab-9_x.~z";
    expect(safeNext(consent)).toBe(consent);
    expect(safeNext(decodeURIComponent(encodeURIComponent(consent)))).toBe(consent);
  });
});
