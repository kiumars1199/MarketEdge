// AUDIT run 2 fail 3: no method on any /api/admin* path tells a non-admin the route exists (404, never 405).
// Two layers: the middleware answers 404 before routing, and each route handler runs requireAdmin() first.
import { afterEach, describe, expect, it, vi } from "vitest";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const LIST = "owner@example.com";
const owner = { id: "u1", email: "owner@example.com", verified: true };
const free = { id: "u2", email: "free@example.com", verified: true };

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/auth/server"); vi.doUnmock("@supabase/ssr"); vi.doUnmock("@/lib/config"); vi.doUnmock("@/lib/maintenance"); vi.unstubAllEnvs(); });

async function routes(user: typeof owner | null) {
  vi.stubEnv("ADMIN_EMAILS", LIST);
  vi.doMock("@/lib/config", async (orig) => ({ ...(await orig<object>()), DEMO_MODE: false }));
  vi.doMock("@/lib/auth/server", async (orig) => ({ ...(await orig<object>()), getUser: async () => user, supabaseAdmin: () => ({}) }));
  const admin = await import("@/app/api/admin/route");
  const exp = await import("@/app/api/admin/export/route");
  return [[admin, "POST"], [exp, "GET"]] as const;
}
type Handler = (req: Request) => Promise<Response>;
const handler = (mod: object, m: string) => (mod as Record<string, Handler | undefined>)[m] ?? (m === "HEAD" ? (mod as Record<string, Handler>).GET : undefined);

describe("admin route handlers", () => {
  it("every method is exported, and runs requireAdmin first: anon and free get 404", async () => {
    for (const user of [null, free]) {
      for (const [mod] of await routes(user)) {
        for (const m of METHODS) {
          const h = handler(mod, m);
          expect(h, m).toBeTypeOf("function");
          await expect(h!(new Request("https://me.test/api/admin", { method: m })), m).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
        }
      }
      vi.resetModules();
    }
  });

  it("an admin gets 405 with Allow on the unsupported methods", async () => {
    for (const [mod, allowed] of await routes(owner)) {
      for (const m of METHODS.filter((x) => x !== allowed && !(allowed === "GET" && x === "HEAD"))) {
        const res = await handler(mod, m)!(new Request("https://me.test/api/admin", { method: m }));
        expect(res.status, m).toBe(405);
        expect(res.headers.get("Allow")).toBe(allowed);
      }
    }
  });
});

describe("middleware: /api/admin* is 404 before routing for non-admins", () => {
  async function mw(user: { email: string; email_confirmed_at: string } | null, keys = true) {
    vi.stubEnv("ADMIN_EMAILS", LIST);
    if (keys) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    }
    vi.stubEnv("DEMO_MODE", "false");
    vi.doMock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: null } }) } }) }));
    vi.doMock("@/lib/maintenance", () => ({ maintenanceOn: async () => false }));
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    return (path: string, method: string) => middleware(new NextRequest(`http://t${path}`, { method }));
  }
  const PATHS = ["/api/admin", "/api/admin/export", "/api/admin/nope"];

  it("anon, free and no-auth-configured: every method on every admin path is 404", async () => {
    for (const [user, keys] of [[null, true], [{ email: "free@example.com", email_confirmed_at: "x" }, true], [null, false]] as const) {
      const hit = await mw(user, keys);
      for (const p of PATHS) for (const m of METHODS) expect((await hit(p, m)).status, `${m} ${p}`).toBe(404);
      vi.resetModules();
    }
  });

  it("an admin passes through to the route; other paths are untouched", async () => {
    const hit = await mw({ email: "owner@example.com", email_confirmed_at: "x" });
    expect((await hit("/api/admin", "POST")).status).toBe(200);   // NextResponse.next()
    const anon = await (vi.resetModules(), mw(null));
    // T-276: signed out, other API routes get the account wall's 401, not the admin 404
    expect((await anon("/api/markets", "GET")).status).toBe(401);
    expect((await anon("/api/administrator", "GET")).status).toBe(401);
    expect((await anon("/api/health", "GET")).status).toBe(200);
    const free = await (vi.resetModules(), mw({ email: "free@example.com", email_confirmed_at: "x" }));
    expect((await free("/api/markets", "GET")).status).toBe(200);
    expect((await free("/api/administrator", "GET")).status).toBe(200);
  });
});
