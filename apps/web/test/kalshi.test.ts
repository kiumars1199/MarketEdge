// /api/kalshi and /kalshi (docs/03 § kalshi.json): live for every signed-in plan once KALSHI_DATA_PERMISSION=true
// (owner decision, Nov 21; docs/16 §2); 404 without the flag. Every row credits Kalshi and links to kalshi.com.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/entitlements";
import type { KalshiFile } from "@/lib/types";

const h = vi.hoisted(() => ({ tier: "free" as Tier }));
vi.mock("@/lib/auth/server", () => ({ getMe: async () => ({ user: { id: "u1", email: "u@x.test" }, tier: h.tier, beta: false }) }));

const load = async () => {
  vi.resetModules();   // fresh kalshi.json cache per test
  return (await import("@/app/api/kalshi/route")).GET;
};
const TIERS: Tier[] = ["free", "pro", "premium"];

describe("/api/kalshi", () => {
  afterEach(() => { vi.unstubAllEnvs(); h.tier = "free"; });

  it("404s on every plan while KALSHI_DATA_PERMISSION is off", async () => {
    for (const t of TIERS) {
      h.tier = t;
      const res = await (await load())();
      expect(res.status, t).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("404s when the scan wrote no kalshi.json", async () => {
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    vi.stubEnv("DATA_DIR", "test/fixtures/missing");
    expect((await (await load())()).status).toBe(404);
  });

  it("flag on, every plan: kalshi.json shape, sorted by volume, Kalshi credit and kalshi.com links, never shared-cached", async () => {
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    for (const t of TIERS) {
      h.tier = t;
      const res = await (await load())();
      expect(res.status, t).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const body = (await res.json()) as KalshiFile;
      expect(body.meta).toMatchObject({ source: "Kalshi", attribution: expect.stringContaining("Kalshi"), fetched_at: expect.any(Number) });
      expect(body.markets.map((m) => m.ticker)).toEqual(["KXNBAGAME-26NOV19LACSAS-SAS", "KXELONMARS-99"]);
      for (const m of body.markets) expect(m).toMatchObject({ source: "Kalshi", url: expect.stringMatching(/^https:\/\/kalshi\.com\//) });
      for (const c of body.combos) {
        expect(c.source).toBe("Kalshi");
        expect(["kalshi_quote", "legs_product"]).toContain(c.price_basis);
        for (const l of c.legs) expect(l.url).toMatch(/^https:\/\/kalshi\.com\//);
      }
    }
  });

  it("passes the Nov 2026 fields through: quote fields, crawl meta and settlements (fixture, not the live API)", async () => {
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    vi.stubEnv("DATA_DIR", "test/fixtures/kalshi-v2");
    const body = (await (await (await load())()).json()) as KalshiFile;
    expect(body.meta).toMatchObject({ complete: true, n_markets_open: 1, n_events: 1, pages: 1, n_settled: 1, notes: [] });
    expect(body.markets[0]).toMatchObject({ no_ask_cents: 60, last_price_cents: 41, volume_24h: 90, open_interest: 300, status: "active" });
    expect(body.settled).toEqual([expect.objectContaining({ ticker: "KXG-1-A", result: "no", source: "Kalshi" })]);
  });
});

describe("/kalshi page", () => {
  afterEach(() => { vi.unstubAllEnvs(); h.tier = "free"; });
  const page = async () => { vi.resetModules(); return (await import("@/app/kalshi/page")).default; };

  it("is notFound while KALSHI_DATA_PERMISSION is off, on any plan", async () => {
    h.tier = "premium";
    await expect((await page())()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("renders the board for Free, Pro and Premium with the flag on, with no Beta banner", async () => {
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    for (const t of TIERS) {
      h.tier = t;
      const el = (await (await page())()) as { props: { data?: KalshiFile } };
      expect(el.props.data?.meta.source, t).toBe("Kalshi");
      expect(JSON.stringify(el)).not.toContain("beta-banner");
    }
  });

  it("no kalshi.json yet: an empty state, not the 404 the nav link would lead to (audit run 3, 3-c)", async () => {
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    vi.stubEnv("DATA_DIR", "test/fixtures/missing");
    expect(JSON.stringify(await (await page())())).toContain("No Kalshi data yet");
  });
});
