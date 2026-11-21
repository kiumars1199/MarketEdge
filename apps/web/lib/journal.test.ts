import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@/lib/repo/types";
import { clv, cumulative, day, entryReturn, fromCsv, pnl, settlePatch, stake, summarize, toCsv } from "./journal";

const bet = (o: Partial<JournalEntry> = {}): JournalEntry => ({
  id: "j1", market_id: "m1", side_index: 0, outcome: "Yes", question: "Will it, \"really\"?", category: "sports", niche: "nfl",
  price: 0.6, shares: 100, fee: 0.012, placed_at: "2026-11-16T03:30:00.000Z",
  model_win_prob: 0.7, model_edge: 0.088, closing_price: null, result: null, settled_at: null, pnl_usd: null, tags: [], note: null,
  ...o,
});

describe("journal P&L", () => {
  it("win, loss, void, fees", () => {
    expect(pnl(bet(), "won")).toBeCloseTo(100 * (1 - 0.6 - 0.012), 10);
    expect(pnl(bet(), "lost")).toBeCloseTo(-100 * 0.612, 10);
    expect(pnl(bet(), "void")).toBe(0);
    expect(pnl(bet({ fee: 0 }), "won")).toBeCloseTo(40, 10);
    expect(stake(bet())).toBeCloseTo(61.2, 10);
  });
  it("CLV = closing − entry", () => {
    expect(clv(bet({ closing_price: 0.66 }))).toBeCloseTo(0.06, 12);
    expect(clv(bet())).toBeNull();
    expect(entryReturn(bet())).toBeCloseTo((0.088 / 0.612) * 100, 10);
  });
  it("settles from /api/settle", () => {
    const now = new Date("2026-11-17T00:00:00Z");
    expect(settlePatch(bet(), { resolved: true, winner_side_index: 0, closing_prices: [0.7, 0.3] }, now))
      .toEqual({ closing_price: 0.7, result: "won", pnl_usd: pnl(bet(), "won"), settled_at: now.toISOString() });
    expect(settlePatch(bet({ side_index: 1 }), { resolved: true, winner_side_index: 0, closing_prices: [null, null] }, now))
      .toMatchObject({ result: "lost" });
    expect(settlePatch(bet(), { resolved: true, winner_side_index: null, closing_prices: [null, null] }, now))
      .toMatchObject({ result: "void", pnl_usd: 0 });
    expect(settlePatch(bet(), { resolved: false, winner_side_index: null, closing_prices: [null, null] })).toBeNull();
    expect(settlePatch(bet({ result: "won" }), { resolved: true, winner_side_index: 1, closing_prices: [null, null] })).toBeNull();
  });
  it("summary tiles", () => {
    const rows = [
      bet({ id: "a", result: "won", pnl_usd: pnl(bet(), "won"), closing_price: 0.65 }),
      bet({ id: "b", result: "lost", pnl_usd: pnl(bet(), "lost"), closing_price: 0.55 }),
      bet({ id: "c", result: "void", pnl_usd: 0 }),
      bet({ id: "d" }),
    ];
    const s = summarize(rows);
    expect(s).toMatchObject({ bets: 4, open: 1, settled: 3 });
    expect(s.pnl).toBeCloseTo(38.8 - 61.2, 10);
    expect(s.roi).toBeCloseTo(((38.8 - 61.2) / 122.4) * 100, 8);
    expect(s.win_rate).toBe(0.5);
    expect(s.avg_clv).toBeCloseTo(0, 10);
    expect(summarize([]).roi).toBeNull();
    expect(cumulative(rows).map((p) => p.n)).toEqual([1, 2, 3]);
  });
  it("timezone-correct dates", () => {
    expect(day("2026-11-16T03:30:00.000Z", "America/New_York")).toBe("Nov 15, 2026");
    expect(day("2026-11-16T03:30:00.000Z", "Europe/Berlin")).toBe("Nov 16, 2026");
    expect(day(null, "UTC")).toBe("—");
  });
  it("CSV round-trips", () => {
    const rows = [bet({ note: "line1, with comma" }), bet({ id: "x", side_index: 1, result: "lost", pnl_usd: -61.2 })];
    const back = fromCsv(toCsv(rows));
    expect(back.skipped).toBe(0);
    expect(back.rows).toHaveLength(2);
    const { id: _id, ...want } = rows[0]!;
    expect(back.rows[0]).toEqual(want);
    expect(fromCsv("market_id,side_index,price,shares\nm,0,1.5,10\n,0,0.5,10\nm2,1,0.4,5").rows).toHaveLength(1);
  });
});

it("RT3-04: journal CSV neutralizes formulas and round-trips the text", () => {
  const e = { market_id: "m1", side_index: 0, outcome: "Yes", question: "=1+1", category: "c", niche: "n", price: 0.5, shares: 2, fee: 0, placed_at: 1, note: "@x" };
  const csv = toCsv([e as never]);
  expect(csv.split("\n")[1]).toContain(",'=1+1,");
  const back = fromCsv(csv).rows[0]!;
  expect(back.question).toBe("=1+1");
  expect(back.note).toBe("@x");
});
