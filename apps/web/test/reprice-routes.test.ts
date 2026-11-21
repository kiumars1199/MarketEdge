// Live re-pricing wiring (lib/data/respond.ts): only live tiers get live prices, on Best bets, All markets and the
// drawer; Free (including a counted reveal) keeps the delayed scan; the server-rendered first page and /api/flags
// return the same body (listBody).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/entitlements";
import type { MarketResponse, MarketsResponse } from "@/lib/api";
import type { Quotes } from "@/lib/reprice";

const h = vi.hoisted(() => ({ tier: "free" as Tier, user: null as null | { id: string; email: string }, jar: new Map<string, string>() }));
vi.mock("@/lib/auth/server", () => ({
  COOKIE_OPTIONS: { httpOnly: true, sameSite: "lax", path: "/" },
  getMe: async () => ({ user: h.user, tier: h.tier, status: null, current_period_end: null, cancel_at_period_end: false }),
  getTier: async () => h.tier,
  supabaseServer: async () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }), insert: async () => ({ error: null }) }),
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({
    get: (k: string) => (h.jar.has(k) ? { value: h.jar.get(k)! } : undefined),
    set: (k: string, v: string) => void h.jar.set(k, v),
  }),
}));

const flags = (await import("@/app/api/flags/route")).GET;
const markets = (await import("@/app/api/markets/route")).GET;
const market = (await import("@/app/api/markets/[id]/route")).GET;
const { _setReprice, firstPage, listBody } = await import("@/lib/data/respond");
const { CLOSING_SOON } = await import("@/lib/filters/state");
const { serialize } = await import("@/lib/filters/url");
const { getStoreFor } = await import("@/lib/data/store");
const { parse } = await import("@/lib/filters/url");

// Every token quoted 1c above its scan ask (bid 1c below the ask): edges shrink a little, nothing else moves.
const calls: string[][] = [];
const bump = async (tokens: string[]): Promise<Quotes> => {
  calls.push(tokens);
  const store = await getStoreFor("premium");
  const out: Quotes = new Map();
  for (const m of [...store.flags, ...store.markets]) {
    m.sides.forEach((s) => {
      const t = m.tokens?.[s.side_index];
      if (t && tokens.includes(t) && s.ask < 0.97) out.set(t, { at: 42, ask: s.ask + 0.01, bid: s.ask });
    });
  }
  return out;
};

const get = async <T,>(r: Promise<Response>) => (await (await r).json()) as T;
const as = (tier: Tier) => { h.tier = tier; h.user = tier === "free" ? null : { id: `u-${tier}`, email: `${tier}@x.test` }; };

afterEach(() => { _setReprice(null); calls.length = 0; });

describe("live re-pricing routes", () => {
  it("Free gets the same Best bets, All markets and drawer bodies with re-pricing on (15 min behind, no CLOB call)", async () => {
    as("free");
    const before = await get<MarketsResponse>(flags(new Request("http://t/api/flags")));
    const id = before.rows[0]!.market.id;
    const drawerBefore = await get<MarketResponse>(market(new Request(`http://t/api/markets/${id}?detail=1`), { params: Promise.resolve({ id }) }));
    const listBefore = await get<MarketsResponse>(markets(new Request("http://t/api/markets")));
    _setReprice(bump);
    expect(await get<MarketsResponse>(flags(new Request("http://t/api/flags")))).toEqual(before);
    expect(await get<MarketsResponse>(markets(new Request("http://t/api/markets")))).toEqual(listBefore);
    // a counted reveal shows exact numbers (shown = "pro"), still from the delayed scan
    const drawer = await get<MarketResponse & { reveals_left?: number }>(market(new Request(`http://t/api/markets/${id}?detail=1`), { params: Promise.resolve({ id }) }));
    expect(drawer.price_at).toBeUndefined();
    expect(drawer.market.best.ask).toBe(drawerBefore.market.best.ask);
    expect(calls).toHaveLength(0);
  });

  it("Pro gets live prices on Best bets, All markets and the drawer", async () => {
    as("pro");
    _setReprice(bump);
    const best = await get<MarketsResponse>(flags(new Request("http://t/api/flags")));
    expect(best.rows.length).toBeGreaterThan(0);
    expect(best.rows.every((r) => r.price_at === 42)).toBe(true);
    const all = await get<MarketsResponse>(markets(new Request("http://t/api/markets")));
    expect(all.rows.some((r) => r.price_at === 42)).toBe(true);
    const id = best.rows[0]!.market.id;
    const drawer = await get<MarketResponse>(market(new Request(`http://t/api/markets/${id}`), { params: Promise.resolve({ id }) }));
    expect(drawer.price_at).toBe(42);
    expect(drawer.market.best.ask).toBe(best.rows[0]!.market.best.ask);
  });

  it("the server's first page equals /api/flags page 1 (same rows, same headline count)", async () => {
    as("pro");
    _setReprice(bump);
    const api = await get<MarketsResponse>(flags(new Request("http://t/api/flags")));
    const store = await getStoreFor("pro");
    const f = { ...parse(new URLSearchParams()), view: "flags" as const, verdicts: ["worth it", "thin"] as ("worth it" | "thin")[] };
    const server = (await listBody(store, f, "pro", "u:u-pro"))!;
    expect(server.total).toBe(api.total);
    expect(server.rows.map((r) => r.market.id)).toEqual(api.rows.map((r) => r.market.id));
  });

  it("P6: the server-rendered first pages equal what the browser would fetch (Best bets, Closing soon, All markets)", async () => {
    for (const tier of ["free", "pro"] as const) {
      as(tier);
      const fl = (await firstPage(new URLSearchParams(), "flags"))!;
      const api = await get<MarketsResponse>(flags(new Request("http://t/api/flags")));
      expect(fl.main.total, tier).toBe(api.total);
      expect(fl.main.rows.map((r) => r.market.id), tier).toEqual(api.rows.map((r) => r.market.id));
      const soonQ = serialize({ ...parse(new URLSearchParams()), view: "flags", verdicts: ["worth it", "thin"], ...CLOSING_SOON } as never);
      const soon = await get<MarketsResponse>(flags(new Request(`http://t/api/flags?${soonQ}`)));
      expect(fl.soon!.rows.map((r) => r.market.id), tier).toEqual(soon.rows.map((r) => r.market.id));
      const mk = (await firstPage(new URLSearchParams("q=win"), "markets"))!;
      const mApi = await get<MarketsResponse>(markets(new Request("http://t/api/markets?q=win")));
      expect(mk.main.total, tier).toBe(mApi.total);
      expect(mk.main.rows.map((r) => r.market.id), tier).toEqual(mApi.rows.map((r) => r.market.id));
      expect(mk.soon).toBeUndefined();
      expect([fl.main.rows.length, mk.main.rows.length].every((n) => n > 0), tier).toBe(true);
    }
  });
  it("P6: Mine filters (fav / wl) are left to the browser", async () => {
    as("pro");
    expect(await firstPage(new URLSearchParams("wl=1"), "markets")).toBeUndefined();
  });
});
