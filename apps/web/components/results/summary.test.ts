// T-296: /track-record plain-words helpers. US record first, each bet once, events as the sample, honest test span.
import { describe, expect, it } from "vitest";
import fixture from "@/test/fixtures/backtest.json";
import { ret } from "@/lib/format";
import { eventsNeeded, liveBase, siteProof, testSpan, testWeeks, usEvents } from "@/lib/proof";
import type { BacktestFile, LedgerStats, LedgerSummary } from "@/lib/types";
import {
  biggestGroup, compareSentence, intlOnlyNote, liveHeadline, ratedHigher, samePayoutHeadline, samePayoutRows, testHeadline,
  usHeadline, weeksHeadline,
} from "./summary";

const b = fixture as unknown as BacktestFile;
const taker = b.results[String(b.chosen_half_life_days ?? "None")].taker;
const S = (graded: number, wins: number, avg_pnl: number, events?: number, entries = graded): LedgerStats =>
  ({ entries, graded, wins, losses: graded - wins, avg_pnl, avg_clv: null, events });
const NOV17 = Date.UTC(2026, 10, 17) / 1000;

// raw rows (re-flags counted twice) vs each bet once; one cent per share either way so returns are easy to read
const raw = S(862, 667, -0.017, 179, 2687);
const first = S(593, 460, -0.0056, 179, 2294);
const base: LedgerSummary = { ...raw, by_category: { weather: S(547, 430, -0.002), sports: S(315, 237, -0.043) }, updated_at: NOV17 };

describe("live record: four states", () => {
  it("no ledger: says the record has not started", () => {
    expect(usHeadline(undefined).value).toBe("—");
    expect(liveHeadline(undefined, null).sentence).toMatch(/No live record/);
    expect(intlOnlyNote(undefined)).toBeNull();
  });
  it("ledger written before the US venue (no `us`, no `first`): falls back to the raw rows", () => {
    expect(usHeadline(base)).toMatchObject({ value: "—" });
    expect(usHeadline(base).sentence).toMatch(/No bets on Polymarket US logged yet/);
    expect(liveBase(base)).toBe(base);
    expect(liveHeadline(base, "Nov 17").sentence).toMatch(/^Return on 862 settled bets logged since Nov 17/);
  });
  it("US bets logged but none settled", () => {
    const l = { ...base, first, us: { ...S(0, 0, 0, 0, 12), avg_pnl: null, by_category: {} } };
    expect(usHeadline(l)).toEqual({ value: "—", tone: "flat", sentence: "12 best bets on Polymarket US logged at the US price, none settled yet." });
  });
  it("US record settled: leads with its return, events counted", () => {
    const u = S(40, 36, 0.05, 9);
    const l = { ...base, first, us: { ...u, by_category: {} }, intl_only: S(553, 424, -0.01) };
    const h = usHeadline(l);
    expect(h.tone).toBe("pos");
    expect(h.value).toBe(ret((40 * 0.05) / (36 - 40 * 0.05) * 100));
    expect(h.sentence).toMatch(/^Return on 40 settled bets in 9 events you could place on Polymarket US/);
    // headline whole record uses `first` (each bet once), not the raw rows
    expect(liveHeadline(l, null).sentence).toMatch(/^Return on 593 settled bets logged,/);
    expect(intlOnlyNote(l)).toBe("Including international-only bets US users couldn't place: 553 (mostly weather).");
  });
});

describe("event counts: only the US record's", () => {
  it("old rows without event ids never count as events, even mixed with new rows that have them", () => {
    // 742 old bets (each its own "event") + 30 new US bets in 10 games: first.events = 749 of 772
    const l: LedgerSummary = { ...base, first: S(772, 597, 0.01, 749), us: { ...S(30, 25, 0.02, 10), by_category: {} }, intl_only: S(742, 572, 0.01) };
    expect(usEvents(l)).toBe(10);
    expect(liveHeadline(l, null).sentence).toMatch(/^Return on 772 settled bets logged,/);
    const p = siteProof({ backtest: b, ledger: l, since: NOV17 });
    expect(p.live).toBe(`Live since Nov 17: 772 settled bets, ${ret(p.liveRoi)}; on Polymarket US 30 settled bets in 10 events, ${ret((0.6 / 24.4) * 100)}, still too few to judge (needs ~${eventsNeeded(taker)} events).`);
    expect(p.enough).toBe(false);
  });
  it("no settled US bets: no events, no 'enough' call, no international-only note", () => {
    const l = { ...base, first: S(742, 573, 0.0103, 739) };
    expect(usEvents(l)).toBeNull();
    const p = siteProof({ backtest: b, ledger: l, since: NOV17 });
    expect(p.live).toBe(`Live since Nov 17: 742 settled bets, ${ret(p.liveRoi)}.`);
    expect(p.enough).toBe(false);
    expect(intlOnlyNote({ ...l, intl_only: S(742, 573, 0.01) })).toBeNull();
  });
});

describe("test span from folds[], not folds × days", () => {
  const w = testWeeks(b);
  it("counts weeks with bets and the share in the last two weeks", () => {
    expect(w.weeks).toBe(12);
    expect(w.withBets).toBe(8);
    expect(w.total).toBe(taker.flags);
    expect(w.lastTwoShare).toBeCloseTo((4532 + 4619) / 9666, 6);
  });
  it("reads as dates, never as '1 year'", () => {
    expect(testSpan(b)).toBe("past markets from Aug 29 to Nov 14 (bets in 8 of 12 weeks, 95% in the last 2)");
    expect(testHeadline(taker, testSpan(b)).sentence).not.toMatch(/year/);
    expect(testSpan(null)).toBeNull();
    expect(testHeadline(taker, null).sentence).toMatch(/best bets on past markets,/);
    // a span across New Year names both years; the last week ends 7 days after its start
    const t = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 1000;
    const ny = { test_days: 7, chosen_half_life_days: null, results: { None: { folds: [
      { start: t(2025, 10, 30), flags: 14 }, { start: t(2026, 10, 1), flags: 43 }, { start: t(2026, 10, 8), flags: 43 }] } } };
    expect(testSpan(ny)).toBe("past markets from Nov 30, 2025 to Nov 14, 2026 (bets in 3 of 3 weeks, 86% in the last 2)");
  });
});

describe("proof line for this page", () => {
  it("keeps the test return and the 'Testing: ' basis, judges live on events", () => {
    const l = { ...base, first, us: { ...S(60, 52, 0.03, 20), by_category: {} } };
    const p = siteProof({ backtest: b, ledger: l, since: NOV17 });
    expect(p.test).toBe(`In testing on past markets from Aug 29 to Nov 14 (bets in 8 of 12 weeks, 95% in the last 2): best bets, ${ret(taker.roi_pct)} per bet.`);
    expect(p.help).toMatch(/^Testing: /);
    const need = eventsNeeded(taker)!;
    expect(need).toBe(Math.ceil(1394 * (2 / 18.51) ** 2));
    expect(p.live).toBe(`Live since Nov 17: 593 settled bets, ${ret(p.liveRoi)}; on Polymarket US 60 settled bets in 20 events, ${ret((1.8 / 50.2) * 100)}, enough to compare with testing.`);
    expect(p.enough).toBe(true);
  });
  it("no events needed when the test lost money", () => {
    expect(eventsNeeded({ ...taker, roi_pct: -1 })).toBeNull();
  });
});

describe("headlines", () => {
  it("compares live with test in one sentence", () => {
    expect(compareSentence({ ...base, first }, taker)).toMatch(/^So far live bets are doing worse than testing/);
    expect(compareSentence(undefined, taker)).toBeNull();
  });
  it("retitles the edge section only when every big group earns more than the one below", () => {
    expect(ratedHigher([{ bets: 100, realized: 2 }, { bets: 100, realized: 3 }, { bets: 100, realized: 5 }]).title).toBe("Bets we rated higher did better");
    // production Nov 20: 13.1, 14.0, 10.2, 16.9 — not monotonic, keep the question
    expect(ratedHigher([{ bets: 9e3, realized: 13.1 }, { bets: 9e3, realized: 14 }, { bets: 5e3, realized: 10.2 }, { bets: 3e3, realized: 16.9 }]).holds).toBe(false);
    // a tiny group out of order does not count
    expect(ratedHigher([{ bets: 100, realized: 2 }, { bets: 5, realized: 0 }, { bets: 100, realized: 4 }]).holds).toBe(true);
  });
  it("weeks: N of M up, and flags a test that sits in its last two weeks", () => {
    const h = weeksHeadline([{ bets: 0, dir: "none" }, { bets: 10, dir: "down" }, { bets: 90, dir: "up" }, { bets: 100, dir: "up" }]);
    expect(h.value).toBe("2 of 3");
    expect(h.sentence).toMatch(/95% of all test bets come from the last two weeks/);
  });
  it("groups: counts only groups with enough bets", () => {
    const h = biggestGroup([
      { name: "Sports", r: { flags: 500, roi_pct: 12 } }, { name: "Weather", r: { flags: 100, roi_pct: -3 } }, { name: "Tiny", r: { flags: 3, roi_pct: 90 } },
    ], "Categories")!;
    expect(h.value).toBe("1 of 2");
    expect(h.sentence).toBe("Categories with at least 30 test bets made money. The biggest, Sports, returned +12%.");
  });
});

describe("Kismet's picks vs other bets at the same payout", () => {
  const P = (graded: number, roi_pct: number | null, events: number, entries = graded) =>
    ({ entries, graded, wins: 0, avg_pnl: null, roi_pct, events });
  const bands = (all: { picks: ReturnType<typeof P>; others: ReturnType<typeof P> }) => ({ ...base, vs_same_payout: {
    "2-3x": { picks: P(4, 10, 3), others: P(4, -5, 4) },
    "<1.5x": { picks: P(20, 3, 6), others: P(20, 1, 7) },
    all,
  } });
  it("no comparison yet: no card", () => {
    expect(samePayoutHeadline(base, 17)).toBeNull();
    expect(samePayoutRows(base)).toEqual([]);
  });
  it("logged but unsettled", () => {
    const l = { ...base, vs_same_payout: { all: { picks: P(0, null, 0, 5), others: P(0, null, 0, 5) } } };
    expect(samePayoutHeadline(l, 17)!.sentence).toBe("5 same-payout bets logged beside our picks, none settled yet.");
  });
  it("under the events bar: both returns, no difference claimed; the picks' (inflated) event count never shown", () => {
    const h = samePayoutHeadline(bands({ picks: P(24, 4.2, 23), others: P(24, -1.3, 10) }), 17)!;
    expect(h).toMatchObject({ value: "—", tone: "flat" });
    expect(h.sentence).toBe(`Our picks returned ${ret(4.2)}; random bets at the same payouts returned ${ret(-1.3)} over 10 events. Too few to judge yet (needs ~17 events).`);
    expect(h.sentence).not.toMatch(/23/);
  });
  it("over the bar: the difference in points; bands in payout order", () => {
    const l = bands({ picks: P(60, 4.2, 40), others: P(60, -1.3, 20) });
    expect(samePayoutHeadline(l, 17)).toMatchObject({ value: "+5.5 pts", tone: "pos" });
    expect(samePayoutHeadline(l, null)!.value).toBe("—");   // no positive test result: no bar, no claim
    expect(samePayoutRows(l).map((x) => x.band)).toEqual(["<1.5x", "2-3x"]);
  });
});
