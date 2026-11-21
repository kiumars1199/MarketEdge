// Audit fail 2: a market whose closes_at has passed at request time is never listed or offered as a bet,
// and no label ever reads "closes in closed".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closesLine } from "@/lib/format";

vi.mock("@/lib/auth/server", () => ({
  getMe: async () => ({ user: null, tier: "premium", status: null, current_period_end: null, cancel_at_period_end: false }),
  getTier: async () => "premium",
}));

const flagsRoute = (await import("@/app/api/flags/route")).GET;
const marketsRoute = (await import("@/app/api/markets/route")).GET;
const eventRoute = (await import("@/app/api/events/[id]/route")).GET;
const { getStore } = await import("@/lib/data/store");
const { apply } = await import("@/lib/filters/apply");
const { FilterState } = await import("@/lib/filters/state");
const { eventBody, marketBody } = await import("@/lib/data/respond");

const store = await getStore();
const rows = (r: Response) => r.json() as Promise<{ rows: { market: { id: string; closes_at: number } }[]; total: number }>;
// a "now" inside the fixtures' close times: some markets have closed, some are open
const closes = store.flags.map((f) => f.closes_at).sort((a, b) => a - b);
const now = closes[Math.floor(closes.length / 2)]!;

describe("closed markets (request-time filter)", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_CLOCK", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("the fixtures hold flags on both sides of now", () => {
    expect(store.flags.some((f) => f.closes_at <= now)).toBe(true);
    expect(store.flags.some((f) => f.closes_at > now)).toBe(true);
  });

  it("/api/flags and /api/markets never return a closed market", async () => {
    for (const route of [flagsRoute, marketsRoute]) {
      const body = await rows(await route(new Request("http://test/api/flags?ps=200&wp=0")));
      expect(body.rows.length).toBeGreaterThan(0);
      for (const r of body.rows) expect(r.market.closes_at).toBeGreaterThan(now);
    }
  });

  it("apply() drops closed rows from rows, totals and facets", () => {
    const open = store.flags.filter((f) => f.closes_at > now).length;
    const page = apply(store, FilterState.parse({ view: "flags", win_prob_min: 0, page_size: 200 }));
    expect(page.total).toBeLessThanOrEqual(open);
    expect(page.rows.every((r) => r.market.closes_at > now)).toBe(true);
  });

  it("event and market bodies list open markets only; a fully closed event is gone", async () => {
    const m = store.markets.find((x) => (store.byEvent.get(x.event_id) ?? []).some((y) => y.closes_at <= now) && x.closes_at > now)
      ?? store.markets.find((x) => x.closes_at > now)!;
    const ev = eventBody(store, store.byEvent.get(m.event_id)!)!;
    expect(ev.markets.every((x) => x.closes_at > now)).toBe(true);
    expect(marketBody(store, m, "premium").event_markets.every((x) => x.closes_at > now)).toBe(true);

    const closed = store.markets.find((x) => (store.byEvent.get(x.event_id) ?? []).every((y) => y.closes_at <= now))!;
    expect(eventBody(store, store.byEvent.get(closed.event_id)!)).toBeNull();
    const res = await eventRoute(new Request("http://test"), { params: Promise.resolve({ id: closed.event_id }) });
    expect(res.status).toBe(404);
  });
});

describe("closesLine (audit fail 2)", () => {
  const t = 1_000_000_000_000;
  it("reads 'Closed' once the market has closed, never 'closes in closed'", () => {
    expect(closesLine(t / 1000 - 5, t)).toBe("Closed");
    expect(closesLine(t / 1000, t)).toBe("Closed");
    expect(closesLine(t / 1000 + 1800, t)).toBe("closes in 30m");
    expect(closesLine(t / 1000 + 19 * 3600, t, true)).toBe("Closes in 19h");
    for (const dt of [-86400, -1, 0, 1, 3600]) expect(closesLine(t / 1000 + dt, t)).not.toMatch(/closes in closed/i);
  });
});
