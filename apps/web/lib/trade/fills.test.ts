import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@/lib/repo/types";
import { fillRow, recordFills, type OrderView, type TrackedOrder } from "./fills";

const t: TrackedOrder = {
  order_id: "o1", ticker: "KXT", side_index: 0, outcome: "Yes", win_prob: 0.7, market_id: "m1", question: "Q?",
  category: "weather", niche: "weather", limit_cents: 61, placed_at: "2026-11-17T00:00:00.000Z",
};
const v = (filled: number, avg: number | null = 60, fees = 7): OrderView =>
  ({ order_id: "o1", ticker: "KXT", side: "yes", state: filled ? "partial" : "resting", filled, remaining: 10 - filled, avg_price_cents: avg, fees_cents: fees });

function memRepo() {
  const rows: JournalEntry[] = [];
  return {
    rows,
    journal: {
      list: async () => rows,
      get: async (id: string) => rows.find((r) => r.id === id) ?? null,
      insert: async (r: Omit<JournalEntry, "id">) => { const x = { ...r, id: String(rows.length + 1) }; rows.push(x); return x; },
      update: async (id: string, p: Partial<JournalEntry>) => { const r = rows.find((x) => x.id === id)!; Object.assign(r, p); return r; },
      remove: async () => {},
    },
  };
}

describe("paper fills → My bets", () => {
  it("no row until something fills", () => expect(fillRow(t, v(0))).toBeNull());
  it("records entry price, fee per share and Kismet numbers at entry", () => {
    const r = fillRow(t, v(4, 60, 8))!;
    expect(r).toMatchObject({ market_id: "m1", side_index: 0, shares: 4, price: 0.6, fee: 0.02, model_win_prob: 0.7 });
    expect(r.model_edge).toBeCloseTo(0.08);
    expect(r.tags).toContain("kalshi:o1");
  });
  it("one row per order, updated as it fills", async () => {
    const repo = memRepo();
    expect(await recordFills(repo, t, v(4))).toBe(true);
    expect(await recordFills(repo, t, v(4))).toBe(false);
    expect(await recordFills(repo, t, v(10))).toBe(true);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.shares).toBe(10);
  });
});
