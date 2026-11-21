// Beta access (lib/beta.ts): testers see beta features on any plan; everyone else doesn't, whatever their plan; once a
// feature leaves BETA_FEATURES its live rule applies. getMe: admins and live comp grants are testers, admins are Premium.
import { afterEach, describe, expect, it, vi } from "vitest";
import { compLive } from "@/lib/entitlements";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("@/lib/beta-list"); });

describe("canBeta", () => {
  it("Nov 21 (owner decision): nothing is in beta any more", async () => {
    const { BETA_FEATURES } = await import("@/lib/beta");
    expect(BETA_FEATURES).toEqual([]);
  });
  it("while a feature is in beta: testers on any plan, nobody else (not even Premium, not even with Kalshi's flag on)", async () => {
    vi.doMock("@/lib/beta-list", () => ({ BETA_FEATURES: ["combos", "kalshi"] }));
    const { canBeta, BETA_FEATURES } = await import("@/lib/beta");
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    for (const f of BETA_FEATURES) {
      expect(canBeta({ tier: "free", beta: true }, f), f).toBe(true);
      expect(canBeta({ tier: "premium", beta: false }, f), f).toBe(false);
      expect(canBeta({ tier: "premium" }, f), f).toBe(false);
    }
  });
  it("live: combos = Premium, Kalshi = the permission flag on every plan (server only: the nav gets it from /api/me)", async () => {
    const { canBeta } = await import("@/lib/beta");
    expect(canBeta({ tier: "premium" }, "combos")).toBe(true);
    expect(canBeta({ tier: "pro", beta: true }, "combos")).toBe(false);
    expect(canBeta({ tier: "premium", beta: true }, "kalshi")).toBe(false);
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    expect(canBeta({ tier: "free" }, "kalshi")).toBe(true);
    expect(canBeta({ tier: "pro" }, "kalshi")).toBe(true);
  });
});

describe("compLive", () => {
  it("set and unexpired; free, missing or expired comps don't count", () => {
    const now = Date.parse("2026-11-19T00:00:00Z");
    expect(compLive({ comp_tier: "pro", comp_expires_at: null }, now)).toBe(true);
    expect(compLive({ comp_tier: "premium", comp_expires_at: "2026-12-01T00:00:00Z" }, now)).toBe(true);
    expect(compLive({ comp_tier: "pro", comp_expires_at: "2026-11-01T00:00:00Z" }, now)).toBe(false);
    expect(compLive({ comp_tier: "free" }, now)).toBe(false);
    expect(compLive({ comp_tier: null }, now)).toBe(false);
    expect(compLive(null, now)).toBe(false);
  });
});

describe("getMe beta flag", () => {
  const user = (email: string) => ({ id: `id-${email}`, email, email_confirmed_at: "2026-01-01T00:00:00Z" });
  async function meFor(email: string, row: Record<string, unknown> | null) {
    vi.resetModules();
    vi.doMock("@/lib/config", async (o) => ({ ...(await o<object>()), DEMO_MODE: false }));
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: user(email) } }), getSession: async () => ({ data: { session: null } }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
      }),
    }));
    vi.doMock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("ADMIN_EMAILS", "boss@x.test");
    const { getMe } = await import("@/lib/auth/server");
    return getMe();
  }
  afterEach(() => { vi.doUnmock("@/lib/config"); vi.doUnmock("@supabase/ssr"); vi.doUnmock("next/headers"); });

  it("admin: beta and Premium, with no subscription row", async () => {
    expect(await meFor("boss@x.test", null)).toMatchObject({ beta: true, tier: "premium" });
  });
  it("live comp grant: beta, plan from the comp", async () => {
    expect(await meFor("t@x.test", { tier: "free", comp_tier: "pro", comp_expires_at: "2999-01-01T00:00:00Z" })).toMatchObject({ beta: true, tier: "pro" });
  });
  it("expired comp or a paying customer: not beta", async () => {
    expect(await meFor("t@x.test", { tier: "free", comp_tier: "pro", comp_expires_at: "2000-01-01T00:00:00Z" })).toMatchObject({ beta: false, tier: "free" });
    expect(await meFor("p@x.test", { tier: "premium" })).toMatchObject({ beta: false, tier: "premium" });
  });
});
