// T-140: who is an admin, site settings parsing/defaults, comp-tier entitlement.
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminEmails, isAdminEmail } from "@/lib/admin/core";
import { effectiveTier } from "@/lib/entitlements";
import { DEFAULT_SETTINGS, SETTINGS, delayMin, parseSettings, rowCap, setSettingsSnapshot } from "@/lib/settings-core";

const LIST = " Marcyamin10@gmail.com , kiumarsmomtaz@gmail.com,,";

describe("ADMIN_EMAILS", () => {
  it("parses comma-separated, trimmed, lowercased; empty = nobody", () => {
    expect(adminEmails(LIST)).toEqual(["marcyamin10@gmail.com", "kiumarsmomtaz@gmail.com"]);
    expect(adminEmails("")).toEqual([]);
    expect(adminEmails(undefined)).toEqual([]);
  });

  it("matches case-insensitively and exactly, verified email only, never in demo mode", () => {
    expect(isAdminEmail({ email: "MARCYAMIN10@gmail.com", verified: true }, LIST, false)).toBe(true);
    expect(isAdminEmail({ email: "kiumarsmomtaz@gmail.com", verified: true }, LIST, false)).toBe(true);
    expect(isAdminEmail({ email: "kiumarsmomtaz@gmail.com", verified: false }, LIST, false)).toBe(false);   // unverified
    expect(isAdminEmail({ email: "kiumarsmomtaz@gmail.com", verified: true }, LIST, true)).toBe(false);    // demo mode
    expect(isAdminEmail({ email: "kiumarsmomtaz@gmail.com", verified: true }, "", false)).toBe(false);     // empty list
    expect(isAdminEmail({ email: "xkiumarsmomtaz@gmail.com", verified: true }, LIST, false)).toBe(false);  // no substring match
    expect(isAdminEmail({ email: "kiumarsmomtaz@gmail.com.evil.test", verified: true }, LIST, false)).toBe(false);
    expect(isAdminEmail({ email: "", verified: true }, LIST, false)).toBe(false);
    expect(isAdminEmail(null, LIST, false)).toBe(false);
  });
});

describe("adminUser() / requireAdmin()", () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/auth/server"); vi.doUnmock("@/lib/config"); vi.unstubAllEnvs(); });

  async function load(user: { id: string; email: string; verified: boolean } | null, demo: boolean) {
    vi.stubEnv("ADMIN_EMAILS", LIST);
    vi.doMock("@/lib/config", async (orig) => ({ ...(await orig<object>()), DEMO_MODE: demo }));
    vi.doMock("@/lib/auth/server", () => ({ getUser: async () => user, supabaseAdmin: () => ({ service: true }) }));
    return import("@/lib/admin/server");
  }
  const owner = { id: "u1", email: "KiumarsMomtaz@gmail.com", verified: true };

  it("signed-in verified owner = admin", async () => {
    const m = await load(owner, false);
    expect(await m.adminUser()).toEqual(owner);
    expect((await m.requireAdmin()).db).toEqual({ service: true });
  });

  it("anon, other users, unverified and demo mode get a 404 (notFound), never the service client", async () => {
    for (const [user, demo] of [[null, false], [{ id: "u2", email: "user@example.com", verified: true }, false],
      [{ ...owner, verified: false }, false], [owner, true]] as const) {
      const m = await load(user, demo);
      expect(await m.adminUser()).toBeNull();
      await expect(m.requireAdmin()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
      vi.resetModules();
    }
  });
});

describe("site settings", () => {
  afterEach(() => setSettingsSnapshot(undefined));

  it("defaults are today's behavior (Free 10 rows, 15 min delay, sign-ups open, alerts on)", () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ free_rows: 10, free_delay_min: 15, signups_open: true, alerts_enabled: true, maintenance: false, banner_on: false });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("each row is validated alone; bad or unknown rows fall back to the default", () => {
    const s = parseSettings([
      { key: "banner_on", value: true }, { key: "banner_text", value: "  Scheduled upgrade tonight  " },
      { key: "free_rows", value: 0 }, { key: "free_delay_min", value: 100000 }, { key: "maintenance", value: "yes" },
      { key: "trading_allowlist", value: ["A@B.co", "not-an-email"] }, { key: "is_admin", value: true },
    ]);
    expect(s.banner_on).toBe(true);
    expect(s.banner_text).toBe("Scheduled upgrade tonight");
    expect(s.free_rows).toBe(10);
    expect(s.free_delay_min).toBe(15);
    expect(s.maintenance).toBe(false);
    expect(s.trading_allowlist).toEqual([]);
    expect(s).not.toHaveProperty("is_admin");
    expect(parseSettings([{ key: "trading_allowlist", value: ["A@B.co"] }]).trading_allowlist).toEqual(["a@b.co"]);
  });

  it("bounds: rows 1–200, delay 0–60, banner ≤ 280 chars, unknown keys rejected", () => {
    expect(SETTINGS.shape.free_rows.safeParse(201).success).toBe(false);
    expect(SETTINGS.shape.free_rows.safeParse(2.5).success).toBe(false);
    expect(SETTINGS.shape.free_delay_min.safeParse(-1).success).toBe(false);
    expect(SETTINGS.shape.banner_text.safeParse("x".repeat(281)).success).toBe(false);
    expect(SETTINGS.partial().safeParse({ free_rows: 10, extra: 1 }).success).toBe(false);
  });

  it("Free row cap and delay follow the snapshot; paid tiers don't", () => {
    expect([rowCap("free"), delayMin("free")]).toEqual([10, 15]);
    setSettingsSnapshot({ ...DEFAULT_SETTINGS, free_rows: 10, free_delay_min: 30 });
    expect([rowCap("free"), delayMin("free")]).toEqual([10, 30]);
    expect([rowCap("pro"), delayMin("pro"), rowCap("premium"), delayMin("premium")]).toEqual([Infinity, 0, Infinity, 0]);
  });
});

describe("comp tier (effectiveTier)", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  it("takes the higher of the paid tier and an unexpired comp", () => {
    expect(effectiveTier({ tier: "free" }, now)).toBe("free");
    expect(effectiveTier(null, now)).toBe("free");
    expect(effectiveTier({ tier: "free", comp_tier: "pro" }, now)).toBe("pro");                 // no expiry
    expect(effectiveTier({ tier: "free", comp_tier: "premium", comp_expires_at: "2026-12-01T00:00:00Z" }, now)).toBe("premium");
    expect(effectiveTier({ tier: "premium", comp_tier: "pro" }, now)).toBe("premium");          // never lowers a paid plan
    expect(effectiveTier({ tier: "pro", comp_tier: "premium" }, now)).toBe("premium");
  });
  it("ignores expired or unknown comps", () => {
    expect(effectiveTier({ tier: "free", comp_tier: "pro", comp_expires_at: "2026-11-17T11:59:59Z" }, now)).toBe("free");
    expect(effectiveTier({ tier: "pro", comp_tier: "premium", comp_expires_at: "2026-01-01T00:00:00Z" }, now)).toBe("pro");
    expect(effectiveTier({ tier: "free", comp_tier: "enterprise" }, now)).toBe("free");
    expect(effectiveTier({ tier: "admin" }, now)).toBe("free");
  });
});

describe("RT2-01: user export only from our own pages", async () => {
  const { sameSiteRequest } = await import("@/lib/auth/server");
  const req = (h: Record<string, string>) => new Request("https://me.test/api/admin/export", { headers: h });
  it("accepts a same-origin link click or a same-origin Origin", () => {
    expect(sameSiteRequest(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameSiteRequest(req({ origin: "https://me.test" }))).toBe(true);
  });
  it("refuses cross-site navigations and foreign origins", () => {
    expect(sameSiteRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameSiteRequest(req({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(sameSiteRequest(req({ origin: "https://evil.test" }))).toBe(false);
    expect(sameSiteRequest(req({}))).toBe(false);
  });
});
