// RT3-06: with ADMIN_REQUIRE_MFA=true an admin session must be aal2 (Supabase MFA, TOTP) in requireAdmin and in the
// middleware's /api/admin check. Unset (the default) = email + magic link, as before.
import { afterEach, describe, expect, it, vi } from "vitest";

const owner = { id: "u1", email: "owner@example.com", verified: true };
const aal = (level: string) => ({ auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: level } }) } } });
afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/auth/server"); vi.doUnmock("@supabase/ssr"); vi.doUnmock("@/lib/config"); vi.doUnmock("@/lib/maintenance"); vi.unstubAllEnvs(); });

async function adminUser(level: string, flag: string) {
  vi.stubEnv("ADMIN_EMAILS", owner.email);
  vi.stubEnv("ADMIN_REQUIRE_MFA", flag);
  vi.doMock("@/lib/config", async (orig) => ({ ...(await orig<object>()), DEMO_MODE: false }));
  vi.doMock("@/lib/auth/server", async (orig) => ({ ...(await orig<object>()), getUser: async () => owner, supabaseServer: async () => aal(level) }));
  return (await import("@/lib/admin/server")).adminUser();
}

async function mw(level: string, flag: string) {
  vi.stubEnv("ADMIN_EMAILS", owner.email);
  vi.stubEnv("ADMIN_REQUIRE_MFA", flag);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("DEMO_MODE", "false");
  vi.doMock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { email: owner.email, email_confirmed_at: "x" } } }), getSession: async () => ({ data: { session: null } }), ...aal(level).auth } }) }));
  vi.doMock("@/lib/maintenance", () => ({ maintenanceOn: async () => false }));
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("@/middleware");
  return (await middleware(new NextRequest("http://t/api/admin", { method: "POST" }))).status;
}

describe("ADMIN_REQUIRE_MFA", () => {
  it("requireAdmin: aal1 is not an admin when the flag is on", async () => {
    expect(await adminUser("aal1", "true")).toBeNull();
    vi.resetModules();
    expect(await adminUser("aal2", "true")).toEqual(owner);
    vi.resetModules();
    expect(await adminUser("aal1", "")).toEqual(owner);
  });

  it("middleware: /api/admin is 404 for an aal1 admin when the flag is on", async () => {
    expect(await mw("aal1", "true")).toBe(404);
    vi.resetModules();
    expect(await mw("aal2", "true")).toBe(200);
    vi.resetModules();
    expect(await mw("aal1", "")).toBe(200);
  });
});
