// Regression tests for REDTEAM.md (run 1). Each case failed before its fix (T-160).
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); });

describe("RT-07 rate-limit key comes from the platform, not X-Forwarded-For", () => {
  it("rotating X-Forwarded-For buys no extra requests", async () => {
    const { clientKey, memoryLimiter } = await import("@/lib/abuse");
    const lim = memoryLimiter(() => 1_000_000);
    const req = (ip: string) => new Request("http://x/api/markets", { headers: { "x-forwarded-for": ip } });
    let rotated = 0;
    for (let i = 0; i < 61; i++) if ((await lim.limit("markets", clientKey(req(`10.0.${i >> 8}.${i & 255}`)))).ok) rotated++;
    expect(rotated).toBe(60);
  });

  it("on Vercel: keyed by x-real-ip; a spoofed X-Forwarded-For is ignored", async () => {
    vi.stubEnv("VERCEL", "1");
    const { clientKey } = await import("@/lib/abuse");
    const a = clientKey(new Request("http://x", { headers: { "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" } }));
    const b = clientKey(new Request("http://x", { headers: { "x-real-ip": "1.2.3.4", "x-forwarded-for": "8.8.8.8" } }));
    expect(a).toBe("ip:1.2.3.4");
    expect(b).toBe(a);
    expect(clientKey(new Request("http://x", { headers: { "x-vercel-forwarded-for": "5.6.7.8, 10.0.0.1" } }))).toBe("ip:5.6.7.8");
  });
});

describe("RT-02 rate limits never fail open in production", () => {
  it("production without Upstash: per-instance limits (auth 5/min per IP)", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const abuse = await import("@/lib/abuse");
    abuse.setLimiter(undefined);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await abuse.rateLimit("auth_ip", "ip:prod-test"))?.status ?? 200);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    warn.mockRestore();
  });

  it("Upstash error: answered by the per-instance limiter, not served unlimited", async () => {
    const abuse = await import("@/lib/abuse");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    abuse.setLimiter({ limit: async () => { throw new Error("upstash down"); }, rows: async () => 0 } as never);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await abuse.rateLimit("auth_ip", "ip:outage-test"))?.status ?? 200);
    expect(codes.at(-1)).toBe(429);
    abuse.setLimiter(undefined);
    err.mockRestore();
  });
});

describe("RT-12 request bodies are capped while reading", () => {
  /** A 10 MB body without Content-Length; counts how much the server pulled. */
  const big = () => {
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const s = { pulled: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (s.pulled >= 10 * 1024 * 1024) c.close(); else { s.pulled += chunk.byteLength; c.enqueue(chunk); } },
    });
    return { s, init: { method: "POST", body, duplex: "half", headers: { "content-type": "application/json", origin: "http://t" } } as RequestInit };
  };

  it("/api/ext/telemetry: 413 after a few KB, the rest of the stream is never read", async () => {
    const abuse = await import("@/lib/abuse");
    abuse.setLimiter(abuse.memoryLimiter());
    const { POST } = await import("@/app/api/ext/telemetry/route");
    const { s, init } = big();
    const res = await POST(new Request("http://t/api/ext/telemetry", init));
    expect(res.status).toBe(413);
    expect(s.pulled).toBeLessThan(1024 * 1024);
    abuse.setLimiter(undefined);
  });

  it("a declared Content-Length over the cap is refused before reading", async () => {
    const { readJson, TOO_LARGE } = await import("@/lib/body");
    const { s, init } = big();
    const req = new Request("http://t", { ...init, headers: { "content-length": String(10 * 1024 * 1024) } });
    expect(await readJson(req, 4096)).toBe(TOO_LARGE);
    expect(s.pulled).toBeLessThanOrEqual(64 * 1024 * 2);
  });
});

describe("RT-14 health and extension ID give nothing away", () => {
  it("public /api/health: ok + status only; details only with the cron secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.resetModules();
    const { GET } = await import("@/app/api/health/route");
    const pub = await GET(new Request("http://t/api/health"));
    expect(pub.status).toBe(503);
    expect(await pub.json()).toEqual({ ok: false });
    const wrong = await GET(new Request("http://t/api/health", { headers: { authorization: "Bearer nope" } }));
    expect(await wrong.json()).toEqual({ ok: false });
    const full = await GET(new Request("http://t/api/health", { headers: { authorization: "Bearer s3cret" } }));
    expect(await full.json()).toMatchObject({ ok: false, ratelimit: "off", db: "not configured" });
  });

  it("production without NEXT_PUBLIC_EXTENSION_ID trusts no extension origin and never shows the dev ID", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("KALSHI_TRADING_ENV", "demo");
    vi.resetModules();
    const { siteOrExtension } = await import("@/lib/trade/server");
    const dev = new Request("http://t/api/ext/token", { method: "POST", headers: { origin: "chrome-extension://cgoaaiaghbckpalppklocajbdpoelmbd" } });
    expect(siteOrExtension(dev)).toBe(false);
    const { GET } = await import("@/app/api/trade/config/route");
    expect(JSON.stringify(await (await GET(new Request("http://t/api/trade/config"))).json())).not.toContain("cgoaaiag");
  });
});

describe("RT-08 the database quota refusal reaches the user as the plan limit", () => {
  it("plan_quota from the trigger → 403 upgrade, not 400", async () => {
    const { insertRow } = await import("@/lib/repo/server");
    // the app's count still says 0 (a parallel insert landed after it), the trigger refuses
    const db = { from: () => ({ select: async () => ({ count: 0 }), insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "P0001", message: "plan_quota: your plan allows 1 presets", hint: "1" } }) }) }) }) };
    const res = await insertRow({ db: db as never, userId: "u" }, "presets", { name: "p", emoji: null, query: {}, columns: null, sort: null, is_default: false, position: 0 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ upgrade: true, limit: 1 });
  });
});

describe("RT-13 next= with non-ASCII falls back to / instead of a 500", () => {
  it("every accepted next is a valid Location header value", async () => {
    const { safeNext } = await import("@/lib/auth/server");
    for (const bad of ["/　/evil.test", "/é", "/\u0000x", "/x\u007f", "/ "]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBe("/");
      expect(() => new Headers({ location: safeNext(bad) })).not.toThrow();
    }
    expect(safeNext("/flags?topics=sports.nfl")).toBe("/flags?topics=sports.nfl");
  });
});
