// RT-10 regression: an extension token can't outlive the account, its plan, or a bounded lifetime by refreshing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; email: string; banned_until?: string } | null;
const state: { user: U; sub: Record<string, unknown> | null } = { user: null, sub: null };

vi.mock("@/lib/auth/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/server")>()),
  adminEnabled: () => true,
  supabaseAdmin: () => ({
    auth: { admin: { getUserById: async () => (state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { message: "User not found" } }) } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.sub, error: null }) }) }) }),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("EXT_SIGNING_SECRET", "x".repeat(40));
  state.user = { id: "u1", email: "u@x.test" };
  state.sub = { tier: "pro", status: "active" };
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

const refresh = async (token: string) => {
  const { POST } = await import("@/app/api/ext/token/refresh/route");
  return POST(new Request("http://t/api/ext/token/refresh", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
};
const issue = async (tier: "free" | "pro" | "premium", now = Date.now(), iat0 = now) =>
  (await import("@/lib/trade/server")).issueExtToken({ id: "u1", email: "u@x.test" }, tier, now, iat0)!.token;

describe("RT-10 /api/ext/token/refresh re-checks the account", () => {
  it("a deleted account can't refresh", async () => {
    state.user = null;
    expect((await refresh(await issue("premium"))).status).toBe(401);
  });

  it("a banned account can't refresh", async () => {
    state.user = { id: "u1", email: "u@x.test", banned_until: new Date(Date.now() + 86_400_000).toISOString() };
    expect((await refresh(await issue("premium"))).status).toBe(401);
  });

  it("the plan is re-read: a cancelled Premium token comes back Free; an admin comp counts", async () => {
    state.sub = { tier: "free", status: "canceled" };
    expect(await (await refresh(await issue("premium"))).json()).toMatchObject({ tier: "free" });
    state.sub = { tier: "free", comp_tier: "premium", comp_expires_at: new Date(Date.now() + 86_400_000).toISOString() };
    expect(await (await refresh(await issue("free"))).json()).toMatchObject({ tier: "premium" });
  });

  it("refreshing can't stretch one sign-in past 7 days", async () => {
    const now = Date.now();
    expect((await refresh(await issue("pro", now, now - 8 * 86_400_000))).status).toBe(401);
    const ok = await refresh(await issue("pro", now, now - 86_400_000));
    expect(ok.status).toBe(200);
    // the new token keeps the first sign-in time, so the chain still ends on day 7
    const { verifyExtToken } = await import("@/lib/trade/server");
    expect(verifyExtToken((await ok.json()).token)?.iat0).toBe(now - 86_400_000);
  });

  it("a token from before RT-10 (no user id, no first sign-in time) is refused", async () => {
    const { createHmac } = await import("node:crypto");
    const body = Buffer.from(JSON.stringify({ k: "ext", sub: "u@x.test", tier: "premium", exp: Date.now() + 60_000 })).toString("base64url");
    const legacy = `${body}.${createHmac("sha256", "x".repeat(40)).update(body).digest("base64url")}`;   // validly signed, old shape
    expect((await refresh(legacy)).status).toBe(401);
    expect((await refresh("not-a-token")).status).toBe(401);
  });
});
