// RT3-02: /m/<id> and /event/<id> render the same MarketResponse / EventResponse as the API, so they get the API's
// `markets` rate limit and Free's distinct-row budget (ops/redteam/run3/page_scrape.sh: 1,600 pages in 20 s, all 200).
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/entitlements";

const h = vi.hoisted(() => ({ tier: "free" as Tier }));
// T-276: authEnabled false = accounts off, so /m and /event render the data path, not the signed-out teaser (test/teaser.test.ts)
vi.mock("@/lib/auth/server", () => ({ getMe: async () => ({ user: null, tier: h.tier }), getTier: async () => h.tier, authEnabled: () => false, getUser: async () => null }));
const bot = vi.hoisted(() => ({ isBot: false, isVerifiedBot: false }));
vi.mock("botid/server", () => ({ checkBotId: async () => bot }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const { memoryLimiter, rowBudget, setLimiter, FREE_ROWS_PER_HOUR, RULES } = await import("@/lib/abuse");
const { getStore } = await import("@/lib/data/store");
const { default: MarketPage } = await import("@/app/m/[id]/page");
const { default: EventPage } = await import("@/app/event/[id]/page");
const { SlowDownState } = await import("@/components/screener/SlowDownState");

/** True when the page rendered the "slow down" state. */
const slowed = (el: ReactNode): boolean => {
  if (!isValidElement(el)) return false;
  const e = el as ReactElement<{ children?: ReactNode }>;
  return e.type === SlowDownState || [e.props.children].flat().some(slowed);
};
const market = (id: string) => MarketPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
const event = (id: string) => EventPage({ params: Promise.resolve({ id }) });

beforeEach(() => { setLimiter(memoryLimiter()); h.tier = "free"; });

describe("RT3-02: market and event pages are metered like the API", () => {
  it("the markets rule: page loads past the limit render the slow-down state, never a crash", async () => {
    const s = await getStore();
    const ids = s.markets.slice(0, RULES.markets.limit + 1).map((m) => m.id);
    const out = [];
    for (const id of ids) out.push(slowed(await market(id)));
    expect(out.slice(0, -1).every((x) => !x)).toBe(true);
    expect(out.at(-1)).toBe(true);
    expect(slowed(await event(s.markets[0]!.event_id))).toBe(true);
  });

  it("Free: a page for a new market past the distinct-row budget renders the slow-down state", async () => {
    const s = await getStore();
    const req = new Request("http://page/");
    expect(await rowBudget(req, null, Array.from({ length: FREE_ROWS_PER_HOUR }, (_, i) => `fill-${i}`))).toBeNull();
    expect(slowed(await market(s.markets[0]!.id))).toBe(true);
    expect(slowed(await event(s.markets[1]!.event_id))).toBe(true);
    h.tier = "pro";   // paid tiers have no row budget (like the API)
    expect(slowed(await market(s.markets[0]!.id))).toBe(false);
  });

  it("a bot Vercel verified (search engine) skips the limits; an unverified bot doesn't", async () => {
    vi.stubEnv("VERCEL", "1");
    try {
      const s = await getStore();
      const ids = s.markets.slice(0, RULES.markets.limit + 5).map((m) => m.id);
      Object.assign(bot, { isBot: true, isVerifiedBot: true });
      for (const id of ids) expect(slowed(await market(id))).toBe(false);
      Object.assign(bot, { isBot: true, isVerifiedBot: false });   // e.g. a spoofed Googlebot user agent
      const out = [];
      for (const id of ids) out.push(slowed(await market(id)));
      expect(out.at(-1)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      Object.assign(bot, { isBot: false, isVerifiedBot: false });
    }
  });
});
