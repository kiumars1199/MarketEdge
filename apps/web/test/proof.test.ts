// T-290 (outside tester, Nov 20): wherever the backtest return appears, the live record sits beside it, every figure
// computed from backtest.json / ledger_summary.json / ledger.jsonl, with a "needs ~N" threshold from a documented rule.
// T-296: the span comes from folds[] and the threshold is in events, judged on the Polymarket US record.
// Checks the helper (eventsNeeded, liveReturn, testSpan, proofLine), the ledger start date read through the gzip-aware
// loader, and that every surface showing the test return prints the same line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketResponse } from "@/lib/api";
import type { BacktestRecord, LedgerStats, LedgerSummary } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
}));

const { eventsNeeded, HIT_RATE_VS_PROFIT, SAME_FOR_EVERYONE, hitRateLive, withLiveHitRate, JUDGE_T, liveReturn, proofLine, siteProof, sinceDay, testSpan } = await import("@/lib/proof");
const { ret } = await import("@/lib/format");
const { chosenResult } = await import("@/lib/data/model");

const rec = (x: Partial<BacktestRecord>): BacktestRecord => ({ flags: 10027, roi_pct: 8.41, t_stat: 16.77, events: 1500, win_rate: 0.83, ...x } as BacktestRecord);
const stats = (x: Partial<LedgerStats>): LedgerStats => ({ entries: 0, graded: 0, wins: 0, losses: 0, avg_pnl: null, avg_clv: null, ...x });
const ledger = (x: Partial<LedgerSummary>): LedgerSummary => ({ ...stats({}), by_category: {}, updated_at: 1794877967, ...x });
const day = (m: number, d: number) => Date.UTC(2026, m, d) / 1000;
// 12 weekly folds, only the last three with best bets: the old wording called this "1 year" (folds_run × days)
const BT = { test_days: 7, folds_run: 52, chosen_half_life_days: null, results: { None: { folds: [
  ...Array.from({ length: 9 }, (_, i) => ({ start: day(7, 22 + 7 * i), flags: 0 })),
  { start: day(9, 24), flags: 10 }, { start: day(9, 31), flags: 40 }, { start: day(10, 7), flags: 50 }] } } };
const SPAN = "past markets from Oct 24 to Nov 13 (bets in 3 of 12 weeks, 90% in the last 2)";
const NOV17 = Date.UTC(2026, 10, 17, 1, 0) / 1000;

describe("eventsNeeded: settled events for a return the size of the test's to stand out from zero", () => {
  it("e = e_test × (2 ÷ t_test)², rounded up: 1,500 test events at t = 16.77 → 22", () => {
    expect(JUDGE_T).toBe(2);
    expect(eventsNeeded(rec({}))).toBe(Math.ceil(1500 * (2 / 16.77) ** 2));
    expect(eventsNeeded(rec({}))).toBe(22);
    expect(eventsNeeded(rec({ events: 400, t_stat: 2 }))).toBe(400);   // a test that only just cleared the bar needs as many again
    expect(eventsNeeded(rec({ events: 100, t_stat: 40 }))).toBe(1);
  });
  it("no threshold when there is no positive tested result to confirm", () => {
    expect(eventsNeeded(null)).toBeNull();
    expect(eventsNeeded(rec({ roi_pct: -2 }))).toBeNull();
    expect(eventsNeeded(rec({ roi_pct: 0 }))).toBeNull();
    expect(eventsNeeded(rec({ t_stat: -1 }))).toBeNull();
    expect(eventsNeeded(rec({ t_stat: undefined }))).toBeNull();
    expect(eventsNeeded(rec({ events: 29 }))).toBeNull();
    expect(eventsNeeded(rec({ events: undefined }))).toBeNull();
  });
});

describe("liveReturn: total profit ÷ total staked, as the backtest's roi_pct", () => {
  it("matches a direct recompute from ledger-shaped rows (pnl = won − ask − fee per $1 share)", () => {
    const rows = [
      { ask: 0.7, fee: 0.01, won: true }, { ask: 0.8, fee: 0.012, won: true }, { ask: 0.65, fee: 0.011, won: false },
      { ask: 0.9, fee: 0.005, won: true }, { ask: 0.55, fee: 0.012, won: false }, { ask: 0.75, fee: 0.01, won: true },
    ];
    const pnl = rows.map((r) => (r.won ? 1 : 0) - r.ask - r.fee);
    const cost = rows.reduce((a, r) => a + r.ask + r.fee, 0);
    const want = (pnl.reduce((a, b) => a + b, 0) / cost) * 100;
    const wins = rows.filter((r) => r.won).length;
    const l = stats({ graded: rows.length, wins, losses: rows.length - wins, avg_pnl: pnl.reduce((a, b) => a + b, 0) / rows.length });
    expect(liveReturn(l)).toBeCloseTo(want, 9);
  });
  it("null with nothing settled", () => {
    expect(liveReturn(stats({ entries: 704 }))).toBeNull();
    expect(liveReturn(null)).toBeNull();
  });
});

describe("testSpan: the weeks that actually had best bets (folds[]), never folds × days", () => {
  it("first to last week with bets, and the share in the last two weeks", () => {
    expect(testSpan(BT)).toBe(SPAN);
    expect(testSpan(BT)).not.toMatch(/year/);
  });
  it("no folds, or no week with a bet → null", () => {
    expect(testSpan({ test_days: 7, folds_run: 52 })).toBeNull();
    expect(testSpan(null)).toBeNull();
    expect(testSpan({ ...BT, results: { None: { folds: [{ start: day(9, 24), flags: 0 }] } } })).toBeNull();
  });
  it("an even spread still names its weeks and its last-two-weeks share (#36: never \"52 weeks\" alone)", () => {
    const even = { test_days: 7, results: { None: { folds: [10, 10, 10, 10, 10, 10].map((n, i) => ({ start: day(9, 3 + 7 * i), flags: n })) } } };
    expect(testSpan(even)).toBe("past markets from Oct 3 to Nov 13 (bets in 6 of 6 weeks, 33% in the last 2)");
  });
});

describe("proofLine: the test result, then the live record beside it", () => {
  const record = rec({});
  const us = (x: Partial<LedgerStats>) => stats({ ...x });
  it("no ledger yet", () => {
    const p = proofLine({ record, backtest: BT, live: null, since: null });
    expect(p.test).toBe(`In testing on ${SPAN}: ${ret(8.41)} per bet.`);
    expect(p.live).toBe("Live record: starts with the first logged best bet.");
    expect(p.line).toBe(`${p.test} ${p.live}`);
  });
  it("no folds in the file: no span, still the return", () => {
    expect(proofLine({ record, backtest: { test_days: 7, folds_run: 52 }, live: null, since: null }).test).toBe(`In testing: ${ret(8.41)} per bet.`);
  });
  it("logged, none settled: names the start date and the threshold in events", () => {
    const p = proofLine({ record, backtest: BT, live: stats({ entries: 704 }), since: NOV17, who: "best bets" });
    expect(sinceDay(NOV17)).toBe("Nov 17");
    expect(p.test).toBe(`In testing on ${SPAN}: best bets, ${ret(8.41)} per bet.`);
    expect(p.live).toBe("Live since Nov 17: 704 logged, none settled yet (needs ~22 settled events to judge).");
    expect(p.help).toMatch(/^Testing: 10,027 past best bets in 1,500 events/);
    expect(p.help).toMatch(/1,500 test events × \(2 ÷ t-stat 16\.8\)²/);
    expect(p.enough).toBe(false);
  });
  it("settled but no US record: the return, no call either way (events aren't recorded)", () => {
    const l = stats({ entries: 500, graded: 200, wins: 170, losses: 30, avg_pnl: 0.05, events: 199 });
    const p = proofLine({ record, backtest: BT, live: l, since: NOV17 });
    expect(p.live).toBe(`Live since Nov 17: 200 settled bets, ${ret(liveReturn(l))}.`);
    expect(p.enough).toBe(false);
  });
  it("US record too few events: still too few, however many bets", () => {
    const l = stats({ entries: 80, graded: 60, wins: 50, losses: 10, avg_pnl: -0.013 });
    const u = us({ entries: 40, graded: 35, wins: 27, losses: 8, avg_pnl: 0.01, events: 9 });
    const p = proofLine({ record, backtest: BT, live: l, us: u, since: NOV17 });
    expect(p.live).toBe(`Live since Nov 17: 60 settled bets, ${ret(liveReturn(l))}; on Polymarket US 35 settled bets in 9 events, ${ret(liveReturn(u))}, still too few to judge (needs ~22 events).`);
    expect(p.liveRoi).toBeCloseTo(liveReturn(l)!, 9);
  });
  it("US record with enough events to compare", () => {
    const l = stats({ entries: 500, graded: 200, wins: 170, losses: 30, avg_pnl: 0.05 });
    const u = us({ entries: 90, graded: 80, wins: 70, losses: 10, avg_pnl: 0.04, events: 22 });
    const p = proofLine({ record, backtest: BT, live: l, us: u, since: NOV17 });
    expect(p.enough).toBe(true);
    expect(p.live).toMatch(/in 22 events, [+−][\d.]+%, enough to compare with testing\.$/);
  });
  it("a losing test says so and sets no threshold", () => {
    const p = proofLine({ record: rec({ roi_pct: -3.2 }), backtest: BT, live: stats({ entries: 5, graded: 3, wins: 2, losses: 1, avg_pnl: 0.02 }), since: null });
    expect(p.test).toMatch(/−3\.2% per bet \(lost money\)\./);
    expect(p.needs).toBeNull();
    expect(p.live).toMatch(/^Live so far: 3 settled bets, [+−][\d.]+%\.$/);
  });
  it("the hit-rate answer agrees with a record that wins most bets and loses money (#4)", () => {
    expect(HIT_RATE_VS_PROFIT).toMatch(/^Most do/);
    expect(HIT_RATE_VS_PROFIT).toContain("can win most of its bets and still lose money");
    expect(HIT_RATE_VS_PROFIT).not.toMatch(/should cover the losses/);
    const l = { entries: 10, graded: 100, wins: 78, losses: 22, avg_pnl: -0.01 } as never;
    expect(hitRateLive(l)).toMatch(/^Live so far: 78% of 100 settled best bets won, and together they returned [−-]/);
    expect(hitRateLive({ entries: 3, graded: 0, wins: 0, losses: 0, avg_pnl: null } as never)).toBeNull();
    const items = [{ q: "x", a: HIT_RATE_VS_PROFIT }, { q: "y", a: "other" }];
    expect(withLiveHitRate(items, "Live so far: …")[0]!.a).toBe(`${HIT_RATE_VS_PROFIT} Live so far: …`);
    expect(withLiveHitRate(items, null)).toBe(items);
  });
  it("no FAQ says everyone sees the same numbers (#48: Free sees ranges)", () => {
    expect(SAME_FOR_EVERYONE).toContain("Free shows fewer of them, a little later, with ranges");
  });
});

describe("firstFlaggedAt: the live record's start, through the gzip-aware loader", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
  it("reads a gzipped ledger.jsonl from storage, skips torn lines, takes the earliest", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
    const jsonl = [`{"flagged_at":${NOV17 + 60}}`, `{"flagged_at":${NOV17}}`, `{"flagged_at":`, "", `{"other":1}`].join("\n");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("ledger.jsonl") ? new Response(gzipSync(jsonl)) : new Response("", { status: 400 }))));
    const { firstFlaggedAt } = await import("@/lib/data/store");
    expect(await firstFlaggedAt("supabase")).toBe(NOV17);
  });
  it("no ledger file → null", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 400 })));
    const { firstFlaggedAt } = await import("@/lib/data/store");
    expect(await firstFlaggedAt("supabase")).toBeNull();
  });
});

describe("every surface that shows the test return prints the proof line beside it", async () => {
  const { getStore } = await import("@/lib/data/store");
  const store = await getStore();
  const live = ledger({ entries: 704, by_category: { [store.flags[0]!.category]: stats({ entries: 40 }) } });
  const s = { ...store, ledgerSummary: live, ledgerSince: NOV17 };
  const p = siteProof({ backtest: s.backtest, ledger: live, since: NOV17 });
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

  it("the site line uses the chosen result's taker record and the whole ledger", () => {
    const t = chosenResult(store.backtest)!.taker;
    expect(p.test).toContain(`${ret(t.roi_pct)} per bet`);
    expect(p.live).toBe(`Live since Nov 17: 704 logged, none settled yet (needs ~${eventsNeeded(t)!.toLocaleString("en-US")} settled events to judge).`);
  });

  it("/api/backtest carries it", async () => {
    vi.doMock("@/lib/data/store", async (orig) => ({ ...(await orig<object>()), getStore: async () => s }));
    vi.resetModules();
    const { GET } = await import("@/app/api/backtest/route");
    const body = await (await GET()).json();
    expect(body.proof.line).toBe(p.line);
    vi.doUnmock("@/lib/data/store");
    vi.resetModules();
  });

  it("the drawer's category record has the category's live record beside it", async () => {
    const { marketBody } = await import("@/lib/data/respond");
    const { MarketDetail } = await import("@/components/market/MarketDetail");
    const m = store.flags[0]!;
    const body: MarketResponse = marketBody(s, m, "pro");
    expect(body.proof!.live).toMatch(/^Live since Nov 17: 40 logged, none settled yet/);
    const html = renderToStaticMarkup(createElement(MarketDetail, { id: m.id, side: m.best.side_index, initial: body }));
    const t = text(html);
    expect(t).toContain("How bets like this did in testing:");
    expect(t).toContain(body.proof!.live);
  });

  it("the MCP track_record tool prints the same line, its basis and the hit-rate sentence", async () => {
    const { trackRecord } = await import("@/lib/mcp/server");
    const r = await trackRecord({}, {} as never, s);
    const out = (r.content as { text: string }[]).map((c) => c.text).join("\n");
    expect(out).toContain(p.test!);
    expect(out).toContain(p.live);
    expect(out).toContain(HIT_RATE_VS_PROFIT);
  });

  it("/llms.txt carries the line and the hit-rate sentence", async () => {
    vi.doMock("@/lib/data/store", async (orig) => ({ ...(await orig<object>()), getStore: async () => s }));
    vi.resetModules();
    const body = await (await (await import("@/app/llms.txt/route")).GET()).text();
    expect(body).toContain(`${p.test} ${p.live}`);
    expect(body).toContain(HIT_RATE_VS_PROFIT);
    vi.doUnmock("@/lib/data/store");
    vi.resetModules();
  });
});

describe("group records with no live counterpart", () => {
  it("say so in one shared wording instead of borrowing the best-bets line", async () => {
    const { noLiveRecord, LIVE_NOT_BY_BAND } = await import("@/lib/proof");
    expect(noLiveRecord("combos")).toBe("No live record for combos yet: the live record tracks single best bets only.");
    expect(LIVE_NOT_BY_BAND).toMatch(/^No live record by payout band yet/);
  });
});
