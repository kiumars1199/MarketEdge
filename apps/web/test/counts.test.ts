// T-288: one Best bets count. On one frozen scan (DATA_CLOCK=scan, the fixtures), /status, Best bets (the server's
// first page and /api/flags) and "N more on Pro" (the landing shows no count since T-301) all report the same number, every time, and the
// price-check sections add up to it. Also: Free sees exactly FREE_BEST_BETS_A_DAY of them, never an admin setting.
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiRow, MarketsResponse } from "@/lib/api";
import type { Store } from "@/lib/data/store";
import type { StoreMarket } from "@/lib/types";

const tierBox = vi.hoisted(() => ({ tier: "free" as "free" | "pro" }));
vi.mock("@/lib/auth/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/server")>()),
  authEnabled: () => true,
  getUser: async () => null,
  getTier: async () => tierBox.tier,
  getMe: async () => ({ user: tierBox.tier === "free" ? null : { id: "u1", email: "a@b.c" }, tier: tierBox.tier, status: null, current_period_end: null, cancel_at_period_end: false, beta: false }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
vi.mock("@/components/market/BetCard", () => ({ BetCard: ({ r }: { r: ApiRow }) => createElement("article", { "data-market-id": r.market.id }) }));
vi.mock("@/components/pricing/Plans", () => ({ Plans: () => createElement("div") }));
vi.mock("@/lib/telemetry", () => ({ track: () => {} }));

const { getStoreFor } = await import("@/lib/data/store");
const { bestBetsCount, bestBetsRows, bestBetsQuery } = await import("@/lib/data/counts");
const { _setReprice, firstPage, freeSample, listBody, listRoute } = await import("@/lib/data/respond");
const { serialize } = await import("@/lib/filters/url");
const { freeView } = await import("@/lib/data/gate");
const { FREE_BEST_BETS_A_DAY } = await import("@/lib/entitlements");
const { DEFAULT_SETTINGS, setSettingsSnapshot } = await import("@/lib/settings-core");
const StatusPage = (await import("@/app/status/page")).default;
const { LockedBets } = await import("@/components/screener/LockedBets");

const html = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
/** The exact number behind a <Count>: its hover title, or its text when it is already exact. */
const countIn = (out: string, testId: string) => {
  const m = out.match(new RegExp(`data-testid="${testId}"[\\s\\S]*?<span(?: class="[^"]*")?(?: title="([\\d,]+)")?>([^<]+)</span>`));
  expect(m, testId).toBeTruthy();
  return Number((m![1] ?? m![2]!).replace(/,/g, ""));
};

/** Every surface's Best bets number for one tier, as exact integers. */
async function surfaces(tier: "free" | "pro") {
  tierBox.tier = tier;
  const store = await getStoreFor(tier);
  const shared = bestBetsCount(store).total;
  const status = countIn(await html(StatusPage()), "status-best-bets");
  const first = (await firstPage(new URLSearchParams(), "flags"))!.main;
  const api = (await (await listRoute(new Request("http://x/api/flags"), "flags")).json()) as MarketsResponse;
  return { store, shared, status, first, api };
}

describe("one Best bets count (T-288)", () => {
  it("Free: /status, Best bets (first paint and /api/flags) and 'N more on Pro' report the same number", async () => {
    const s = await surfaces("free");
    expect(s.shared).toBeGreaterThan(FREE_BEST_BETS_A_DAY);   // the fixture has more best bets than Free sees
    expect(s.status).toBe(s.shared);
    expect(s.first.total).toBe(s.shared);
    expect(s.api.total).toBe(s.shared);
    // the Free page is the day's sample: exactly FREE_BEST_BETS_A_DAY rows, marked as such, and the rest "on Pro"
    expect(s.first.free_daily).toBe(FREE_BEST_BETS_A_DAY);
    expect(s.first.rows).toHaveLength(FREE_BEST_BETS_A_DAY);
    const locked = await html(createElement(LockedBets, { total: s.first.total, shown: s.first.rows.length, daily: s.first.free_daily!, desktop: true }));
    expect(locked).toContain(`Unlock ${s.shared - FREE_BEST_BETS_A_DAY} more bets`);   // under 1,000: formatCount is exact
    expect(locked).toContain(`Free shows ${FREE_BEST_BETS_A_DAY} Best bets a day`);
  });

  it("Pro: the same number on /status, Best bets and /api/flags, with no Free sample marker", async () => {
    const s = await surfaces("pro");
    expect([s.status, s.first.total, s.api.total]).toEqual([s.shared, s.shared, s.shared]);
    expect(s.first.free_daily).toBeUndefined();
    expect(s.api.free_daily).toBeUndefined();
  });

  it("Pro with live prices on: a bet that lost its edge leaves the page, the count stays the scan's", async () => {
    const store = await getStoreFor("pro");
    // every other token now asks 99c: those bets lose their edge at live prices and drop off the page
    const tokens = store.flags.flatMap((m) => m.tokens ?? []);
    const dear = new Set(tokens.filter((_, i) => i % 2 === 0));
    _setReprice(async (ask: string[]) => new Map(ask.filter((t) => dear.has(t)).map((t) => [t, { at: 42, ask: 0.99, bid: 0.98 }])));
    try {
      const s = await surfaces("pro");
      expect(s.first.rows.length).toBeLessThan(s.first.page_size);   // live prices really dropped rows
      expect([s.status, s.first.total, s.api.total]).toEqual([s.shared, s.shared, s.shared]);
      const p2 = (await (await listRoute(new Request(`http://x/api/flags?${serialize(bestBetsQuery({ page: 2, page_size: 10 }))}`), "flags")).json()) as MarketsResponse;
      expect(p2.total).toBe(s.shared);
    } finally {
      _setReprice(null);
    }
  });

  it("Free never sees more than FREE_BEST_BETS_A_DAY distinct bets, whatever the page, sort, grouping or page size", async () => {
    tierBox.tier = "free";
    const store = await getStoreFor("free");
    const queries = [
      bestBetsQuery(), bestBetsQuery({ page: 2 }), bestBetsQuery({ page: 5 }), bestBetsQuery({ page_size: 200 }),
      bestBetsQuery({ group_by_event: false }), bestBetsQuery({ group_by_event: true }), bestBetsQuery({ sort: { key: "closes", dir: "asc" } }), bestBetsQuery({ sort: { key: "pays", dir: "desc" } }),
      bestBetsQuery({ verdicts: [] }), bestBetsQuery({ tier: "all" }),
    ];
    const seen = new Set<string>();
    for (const q of queries) {
      const body = (await listBody(store, q, "free", "u:same"))!;
      expect(body.rows.length).toBeLessThanOrEqual(FREE_BEST_BETS_A_DAY);
      for (const r of body.rows) seen.add(r.market.id);
      const api = (await (await listRoute(new Request(`http://x/api/flags?${serialize(q)}`), "flags")).json()) as MarketsResponse;
      for (const r of api.rows ?? []) seen.add(r.market.id);
    }
    // the API keys the sample by IP for a signed-out visitor; both keys are one day's sample each
    expect(seen.size).toBeLessThanOrEqual(2 * FREE_BEST_BETS_A_DAY);
    const sameKey = new Set<string>();
    for (const q of queries) for (const r of (await listBody(store, q, "free", "u:same"))!.rows) sameKey.add(r.market.id);
    expect(sameKey.size).toBeLessThanOrEqual(FREE_BEST_BETS_A_DAY);
  });

  it("is stable: every reload of the same scan gives the same number, banded (Free) or not", async () => {
    const store = await getStoreFor("free");
    const runs = await Promise.all(Array.from({ length: 5 }, async () => [bestBetsCount(store).total, bestBetsCount(freeView(store)).total, (await surfaces("free")).status]));
    expect(new Set(runs.flat()).size).toBe(1);
  });

  it("the status page's price-check sections add up to its total", async () => {
    tierBox.tier = "free";
    const out = await html(StatusPage());
    const sections = [...out.matchAll(/data-section="[^"]+"><span(?: class="[^"]*")?(?: title="([\d,]+)")?>([^<]+)<\/span>/g)].map((m) => Number((m[1] ?? m[2]!).replace(/,/g, "")));
    expect(sections.length).toBe(2);
    expect(sections.reduce((a, b) => a + b, 0)).toBe(countIn(out, "status-best-bets"));
  });
});

/** The fixture's best tier is all "worth it"; this variant adds thin, edge-tier, closed, long-shot and "not worth it"
 *  rows, so the sum and the filters are really exercised. */
async function mixedStore(): Promise<Store> {
  const base = await getStoreFor("pro");
  const t = base.meta.scanned_at;
  const flags = base.flags.map((m, i): StoreMarket => {
    const k = i % 6;
    const ex = m.execution ? { ...m.execution } : m.execution;
    if (k === 1 && ex) ex.verdict = "thin";
    if (k === 2 && ex) ex.verdict = "not worth it";
    const out: StoreMarket = { ...m, execution: ex };
    if (k === 3) out.tier = "edge";
    if (k === 4 && i % 12 === 4) out.closes_at = t - 60;   // closed since the scan
    if (k === 5 && i % 12 === 5) { const b = { ...m.best, win_prob: 0.3, win_prob_low: 0.25 }; out.best = b; out.sides = m.sides.map((s) => (s.side_index === b.side_index ? b : s)); }
    return out;
  });
  return { ...base, flags, flagsById: new Map(flags.map((m) => [m.id, m])) };
}

describe("sections and the Free sample on a mixed scan", () => {
  it("sections add up to the total; the total equals the Best bets page for paid and Free", async () => {
    const store = await mixedStore();
    const c = bestBetsCount(store);
    expect(c.sections.thin).toBeGreaterThan(0);
    expect(c.sections["worth it"]).toBeGreaterThan(0);
    expect(c.sections["worth it"] + c.sections.thin).toBe(c.total);
    const t = store.meta.scanned_at;
    for (const r of bestBetsRows(store)) {
      expect(r.market.tier ?? "best").toBe("best");
      expect(r.market.closes_at).toBeGreaterThan(t);
      expect(r.side.win_prob).toBeGreaterThanOrEqual(0.4);
    }
    const paid = (await listBody(store, bestBetsQuery(), "pro", "k"))!;
    const free = (await listBody(freeView(store), bestBetsQuery(), "free", "k"))!;
    expect([paid.total, free.total]).toEqual([c.total, c.total]);
    // the page's own price-check facets are the same sections
    expect([paid.facets.verdicts["worth it"], paid.facets.verdicts.thin]).toEqual([c.sections["worth it"], c.sections.thin]);
  });

  it("Free sees exactly FREE_BEST_BETS_A_DAY on the default page, all from the shared list, whatever free_rows says", async () => {
    const store = await mixedStore();
    const ids = new Set(bestBetsRows(store).map((r) => r.market.id));
    try {
      for (const free_rows of [3, 10, 89]) {
        setSettingsSnapshot({ ...DEFAULT_SETTINGS, free_rows });
        const page = (await listBody(freeView(store), bestBetsQuery(), "free", "u:someone"))!;
        expect(page.rows, `free_rows ${free_rows}`).toHaveLength(FREE_BEST_BETS_A_DAY);
        expect(page.free_daily).toBe(FREE_BEST_BETS_A_DAY);
        for (const r of page.rows) expect(ids.has(r.market.id)).toBe(true);
      }
    } finally {
      setSettingsSnapshot(undefined);
    }
    // banding Free's numbers doesn't change which bets are in the sample
    expect([...freeSample(freeView(store), "u:x")].sort()).toEqual([...freeSample(store, "u:x")].sort());
  });
});

describe("one live-record count (QA-A #49/#63)", () => {
  it("counts each bet once, like /track-record, and its parts add up", async () => {
    const { settledCount } = await import("@/lib/data/counts");
    const stats = (entries: number, graded: number, wins: number, losses: number) => ({ entries, graded, wins, losses, avg_pnl: 0.1, avg_clv: null });
    const l = { ...stats(2400, 1900, 1460, 440), first: stats(1300, 1155, 900, 255), by_category: {}, updated_at: 1 } as unknown as Parameters<typeof settledCount>[0];
    const c = settledCount(l)!;
    expect(c).toEqual({ logged: 1300, settled: 1155, won: 900, lost: 255, void: 0 });
    expect(c.won + c.lost + c.void).toBe(c.settled);
    // a summary written before `first` existed falls back to its rows
    expect(settledCount({ ...stats(5, 3, 2, 1), by_category: {} } as unknown as Parameters<typeof settledCount>[0])).toEqual({ logged: 5, settled: 3, won: 2, lost: 1, void: 0 });
    expect(settledCount(null)).toBeNull();
  });

  it("/status prints that count", async () => {
    tierBox.tier = "pro";
    const { settledCount } = await import("@/lib/data/counts");
    const store = await getStoreFor("pro");
    const out = await html(StatusPage());
    const c = settledCount(store.ledgerSummary);
    if (!c) return expect(out).toContain("No live record yet");
    const { formatCount } = await import("@/lib/format");
    expect(out).toContain(`${formatCount(c.settled)} settled · ${formatCount(c.won)} won · ${formatCount(c.lost)} lost`);
  });
});
