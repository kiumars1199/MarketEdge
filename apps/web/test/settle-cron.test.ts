// T-46: journal settlement cron over a mocked Supabase (settlement source injected, no network).
import { describe, expect, it, vi } from "vitest";
import { settleJournal } from "@/lib/settle";
import { fakeSupabase } from "./fakeSupabase";

describe("settlement cron (T-46)", () => {
  const bet = (o: Record<string, unknown> = {}) => ({
    id: "j1", user_id: "u1", market_id: "m1", side_index: 0, price: 0.6, shares: 10, fee: 0.01, closing_price: null,
    result: null, settled_at: null, pnl_usd: null, placed_at: "2026-11-01T00:00:00Z", ...o,
  });

  it("settles every user's open rows with result, P&L and closing price, then is a no-op", async () => {
    const d = fakeSupabase({ journal: [bet(), bet({ id: "j2", user_id: "u2", side_index: 1 }), bet({ id: "j3", market_id: "m2" })] });
    const settle = vi.fn(async (id: string) => id === "m1"
      ? { resolved: true, winner_side_index: 0 as const, closing_prices: [0.7, 0.3] as [number, number] }
      : { resolved: false, winner_side_index: null, closing_prices: [null, null] as [null, null] });
    const now = new Date("2026-11-17T07:30:00Z");
    expect(await settleJournal(d as never, now, settle)).toEqual({ rows: 3, markets: 2, updated: 2, failed: 0 });
    const [j1, j2, j3] = d.tables.journal!;
    expect(j1).toMatchObject({ result: "won", closing_price: 0.7, settled_at: now.toISOString() });
    expect(j1!.pnl_usd).toBeCloseTo(10 * (1 - 0.61), 6);
    expect(j2).toMatchObject({ result: "lost", closing_price: 0.3 });
    expect(j2!.pnl_usd).toBeCloseTo(-10 * 0.61, 6);
    expect(j3).toMatchObject({ result: null, closing_price: null });

    const again = await settleJournal(d as never, now, settle);
    expect(again.updated).toBe(0);
    expect(again.rows).toBe(1);   // only the still-open m2 row is looked at
  });
});
