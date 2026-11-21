import { afterEach, describe, expect, it, vi } from "vitest";
import { feeCents, fillableNow, NonceRequest, ticketMath } from "./intent";
import { canonical, consumeNonce, issueExtToken, issueNonce, NONCE_TTL_MS, tradingAllowed, tradingEnv, verifyExtToken } from "./server";

const order = { ticker: "KXTEST-26NOV17", side: "yes" as const, price_cents: 61, count: 10, client_order_id: "3f1c2a9e-1b2c-4d5e-8f90-123456789abc" };

afterEach(() => vi.unstubAllEnvs());

describe("trading flag", () => {
  it("is on only for KALSHI_TRADING_ENV=demo", () => {
    vi.stubEnv("KALSHI_TRADING_ENV", "");
    expect(tradingEnv()).toBeNull();
    vi.stubEnv("KALSHI_TRADING_ENV", "prod");
    expect(tradingEnv()).toBeNull(); // production stays off until docs/16 §5
    vi.stubEnv("KALSHI_TRADING_ENV", "demo");
    expect(tradingEnv()).toBe("demo");
  });
  it("allow-lists everyone in demo mode", () => expect(tradingAllowed(null)).toBe(true));
});

describe("nonce", () => {
  it("is one-time and bound to the exact order", async () => {
    const n = issueNonce("place", order)!;
    expect(await consumeNonce(n, "place", { ...order, count: 11 })).toBe(false);
    expect(await consumeNonce(n, "cancel", order)).toBe(false);
    // key order doesn't matter, content does
    const reordered = Object.fromEntries(Object.entries(order).reverse());
    expect(await consumeNonce(n, "place", reordered)).toBe(true);
    expect(await consumeNonce(n, "place", order)).toBe(false); // used
  });
  it("expires", async () => {
    const n = issueNonce("place", order, 0)!;
    expect(await consumeNonce(n, "place", order, NONCE_TTL_MS + 1)).toBe(false);
  });
  it("rejects tampering", async () => {
    const n = issueNonce("place", order)!;
    const [body, sig] = n.split(".");
    expect(await consumeNonce(`${body}x.${sig}`, "place", order)).toBe(false);
    expect(await consumeNonce("garbage", "place", order)).toBe(false);
  });
  it("canonical JSON sorts keys", () => expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}'));
  it("request schema strips nothing it shouldn't and rejects bad intents", () => {
    expect(NonceRequest.safeParse({ action: "place", payload: order }).success).toBe(true);
    expect(NonceRequest.safeParse({ action: "place", payload: { ...order, price_cents: 100 } }).success).toBe(false);
    expect(NonceRequest.safeParse({ action: "place", payload: { ...order, client_order_id: "x" } }).success).toBe(false);
    expect(NonceRequest.safeParse({ action: "transfer", payload: {} }).success).toBe(false);
  });
});

describe("nonce store and signing key (docs/15 § Trading keys)", () => {
  it("used nonces go to Upstash SET NX across instances; a store error refuses", async () => {
    const abuse = await import("@/lib/abuse");
    const seen = new Set<string>();
    const set = vi.fn(async (k: string, _v: unknown, o: { nx: boolean; pxat: number }) => {
      expect(o.nx).toBe(true);
      expect(o.pxat).toBeGreaterThan(Date.now());
      return seen.has(k) ? null : (seen.add(k), "OK");
    });
    const spy = vi.spyOn(abuse, "redis").mockReturnValue({ set } as never);
    const n = issueNonce("place", order)!;
    expect(await consumeNonce(n, "place", order)).toBe(true);
    expect(await consumeNonce(n, "place", order)).toBe(false);   // another instance asking: same answer
    expect(set).toHaveBeenCalledTimes(2);
    set.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await consumeNonce(issueNonce("place", order)!, "place", order)).toBe(false);
    spy.mockRestore();
  });

  it("a production deploy without EXT_SIGNING_SECRET issues nothing, demo mode included", async () => {
    const { secret } = await import("./server");
    expect(secret({ VERCEL_ENV: "production" })).toBeNull();
    expect(secret({ VERCEL_ENV: "production", EXT_SIGNING_SECRET: "short" })).toBeNull();
    expect(secret({ VERCEL_ENV: "production", EXT_SIGNING_SECRET: "x".repeat(32) })).not.toBeNull();
    expect(secret({})).not.toBeNull();   // local demo: per-process key
  });
});

describe("extension token", () => {
  it("round-trips and expires", () => {
    const t = issueExtToken({ id: "u1", email: "u@x" }, "premium", 1_000)!;
    expect(verifyExtToken(t.token, 2_000)).toMatchObject({ sub: "u@x", uid: "u1", tier: "premium" });
    expect(verifyExtToken(t.token, t.exp + 1)).toBeNull();
    expect(verifyExtToken(issueNonce("place", order))).toBeNull(); // a nonce is not a token
  });
});

describe("ticket math", () => {
  it("fee estimate matches the extension's", () => expect(feeCents(10, 61)).toBe(17));
  it("$ amount buys whole contracts with the fee inside the amount", () => {
    const t = ticketMath("usd", 10, 61, 0.7)!;
    expect(t.count).toBe(15);
    expect(t.maxCostCents).toBeLessThanOrEqual(1000);
    expect(t.payoutCents).toBe(1500);
    expect(t.roiPct).toBeCloseTo(((0.7 - t.maxCostCents / 100 / 15) / (t.maxCostCents / 100 / 15)) * 100);
  });
  it("contracts mode and bad input", () => {
    expect(ticketMath("contracts", 3, 50, null)).toMatchObject({ count: 3, costCents: 150, roiPct: null });
    expect(ticketMath("usd", 0.2, 50, 0.6)).toBeNull();
    expect(ticketMath("usd", 10, 0, 0.6)).toBeNull();
  });
  it("fillable now walks the book up to the limit", () => {
    expect(fillableNow([[60, 5], [61, 5], [63, 100]], 61, 20)).toEqual({ now: 10, rests: 10, avgCents: 60.5 });
    expect(fillableNow([], 61, 5)).toEqual({ now: 0, rests: 5, avgCents: null });
  });
});
