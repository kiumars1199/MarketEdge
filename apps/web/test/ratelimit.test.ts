// docs/15 § Bots and abuse: rate limits per route (in-memory limiter standing in for Upstash), 429 + Retry-After,
// keyed by user id else IP, and the > 5,000 rows/hour anomaly log.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/entitlements";

const h = vi.hoisted(() => ({ tier: "pro" as Tier, user: { id: "u1", email: "a@x.test" } as null | { id: string; email: string } }));
vi.mock("@/lib/auth/server", () => ({
  COOKIE_OPTIONS: {},
  authEnabled: () => true,
  sameOrigin: () => true,
  safeNext: (n?: string) => n ?? "/",
  getMe: async () => ({ user: h.user, tier: h.tier }),
  getTier: async () => h.tier,
  getUser: async () => h.user,
  supabaseServer: async () => ({ auth: { signInWithOtp: async () => ({ error: null }) } }),
}));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: false }) }));
vi.mock("@/lib/auth/terms", () => ({ rememberTerms: async () => {} }));
vi.mock("@/lib/billing/stripe", () => ({ PRICE_KEYS: ["pro_monthly"], billingMode: () => "links", paymentLinkUrl: () => "https://buy.stripe.com/x" }));

const abuse = await import("@/lib/abuse");
const { GET: markets } = await import("@/app/api/markets/route");
const { GET: suggest } = await import("@/app/api/suggest/route");
const { POST: magic } = await import("@/app/api/auth/magic-link/route");
const { POST: checkout } = await import("@/app/api/stripe/checkout/route");

const req = (p: string, ip = "1.1.1.1", init?: RequestInit) =>
  new Request(`http://t${p}`, { ...init, headers: { "x-real-ip": ip, "x-forwarded-for": `${ip}, 10.0.0.1`, origin: "http://t", ...(init?.headers ?? {}) } });
const post = (p: string, body: unknown, ip?: string) => req(p, ip, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function until429(call: () => Promise<Response>, max: number) {
  for (let i = 0; i < max; i++) expect((await call()).status, `request ${i + 1}`).not.toBe(429);
  const res = await call();
  expect(res.status).toBe(429);
  expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
}

beforeEach(() => { abuse.setLimiter(abuse.memoryLimiter()); h.user = { id: "u1", email: "a@x.test" }; h.tier = "pro"; });
afterAll(() => abuse.setLimiter(undefined));

describe("rate limits", () => {
  it("markets/flags: 60 a minute per user, 429 with Retry-After", async () => {
    await until429(() => markets(req("/api/markets?ps=1")), 60);
    h.user = { id: "u2", email: "b@x.test" };   // keyed by user: another account is unaffected
    expect((await markets(req("/api/markets?ps=1"))).status).toBe(200);
  });

  it("signed out: keyed by the platform client IP (x-real-ip on Vercel, RT-07)", async () => {
    vi.stubEnv("VERCEL", "1");
    h.user = null; h.tier = "free";
    await until429(() => markets(req("/api/markets", "9.9.9.9")), 30);   // Free list cap (RT-03) is the tighter one
    expect((await markets(req("/api/markets", "8.8.8.8"))).status).toBe(200);
    vi.unstubAllEnvs();
  });

  it("list pages past the first: 50 a minute", async () => {
    await until429(() => markets(req("/api/markets?ps=1&g=0&pg=2")), 50);
  });

  it("suggest: 120 a minute", async () => {
    await until429(() => suggest(req("/api/suggest?q=a")), 120);
  });

  it("auth email window matches docs/15: 5 per 15 minutes per address", () => {
    expect(abuse.RULES.auth_email).toEqual({ limit: 5, window: "15 m" });
    expect(abuse.RULES.auth_password).toEqual({ limit: 5, window: "15 m" });
    expect(abuse.RULES.auth_ip).toEqual({ limit: 5, window: "1 m" });
  });

  it("magic link: 5 a minute per IP and 5 per 15 minutes per email", async () => {
    await until429(() => magic(post("/api/auth/magic-link", { email: "x@y.test", accept: true }, "2.2.2.2")), 5);
    abuse.setLimiter(abuse.memoryLimiter());
    for (let i = 0; i < 5; i++) expect((await magic(post("/api/auth/magic-link", { email: "v@y.test", accept: true }, `3.3.3.${i}`))).status).toBe(200);
    expect((await magic(post("/api/auth/magic-link", { email: "V@y.test", accept: true }, "4.4.4.4"))).status).toBe(429);
  });

  it("checkout: 10 an hour per account", async () => {
    await until429(() => checkout(post("/api/stripe/checkout", { price: "pro_monthly" })), 10);
  });

  it("book: 30 a minute", async () => {
    const { GET: book } = await import("@/app/api/book/route");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    await until429(() => book(req("/api/book?token=123&q=0.5")), 30);
    vi.unstubAllGlobals();
  });
});

describe("anomaly log", () => {
  it("logs once when an account passes 5,000 rows in an hour", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = req("/api/markets");
    for (let i = 0; i < 30; i++) await abuse.noteRows(r, "heavy", 200);   // 6,000 rows
    const hits = warn.mock.calls.filter((c) => String(c[0]).startsWith("[anomaly]"));
    expect(hits).toHaveLength(1);
    expect(String(hits[0]![0])).toContain("u:heavy");
    warn.mockRestore();
  });
});
