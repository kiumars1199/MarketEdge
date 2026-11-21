import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The details need the cron secret (RT-14); the public answer is {ok} + status (test/redteam.test.ts).
const load = async () => {
  const { GET } = await import("@/app/api/health/route");
  return () => GET(new Request("http://t/api/health", { headers: { authorization: "Bearer health-test" } }));
};

beforeEach(() => vi.stubEnv("CRON_SECRET", "health-test"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("/api/health", () => {
  it("200 in local dev with no DB or Stripe configured; flags the old fixture scan as stale", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await (await load())();
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toMatchObject({ ok: true, db: "not configured", stripe: "not configured" });
    expect(b.data).toMatchObject({ scanned_at: expect.any(Number), stale: true, max_age_minutes: 30 });
  });

  it("503 when the DB is configured but unreachable; never echoes the key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-secret");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const res = await (await load())();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("svc-secret");
    expect(text).not.toContain("supabase.co");
    expect(JSON.parse(text)).toMatchObject({ ok: false, db: "unreachable", stripe: "configured" });
  });

  it("200 when the DB answers", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    expect((await (await load())()).status).toBe(200);
  });

  it("live production without Upstash: ratelimit off is degraded (503) so the uptime monitor sees it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const res = await (await load())();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, ratelimit: "off" });
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const on = await (await load())();
    expect(await on.json()).toMatchObject({ ok: true, ratelimit: "on" });
  });

  it("dev reports ratelimit off without failing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    const res = await (await load())();
    expect(res.status).toBe(200);
    expect((await res.json()).ratelimit).toBe("off");
  });

  it("503 when a remote scan is older than the limit", async () => {
    vi.stubEnv("DATA_SOURCE", "github"); // the fixture store is already cached in memory
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await (await load())();
    expect(res.status).toBe(503);
    expect((await res.json()).data.stale).toBe(true);
  });
});
