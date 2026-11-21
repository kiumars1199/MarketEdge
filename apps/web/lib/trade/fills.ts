// Paper fills → My bets (docs/16 §3.4): one journal row per Kalshi order, updated as it fills,
// with entry price, fee and Kismet numbers at entry. Orders we placed are remembered on this device.
import type { Insert, JournalEntry, Repo } from "@/lib/repo/types";

export interface OrderView {
  order_id: string; ticker: string; side: "yes" | "no"; state: "resting" | "partial" | "filled" | "cancelled";
  filled: number; remaining: number; avg_price_cents: number | null; fees_cents: number;
}

/** What we knew when the user confirmed: needed to journal fills later, even after the ticket closed. */
export interface TrackedOrder {
  order_id: string; ticker: string; side_index: 0 | 1; outcome: string; win_prob: number | null;
  market_id: string; question: string; category: string | null; niche: string | null;
  limit_cents: number; placed_at: string; final?: boolean;
}

const KEY = "me.kalshi.orders";
export const orderTag = (id: string) => `kalshi:${id}`;
export const PAPER_TAG = "kalshi-paper";

export function trackedOrders(): TrackedOrder[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as TrackedOrder[]; } catch { return []; }
}
export function trackOrder(o: TrackedOrder) {
  const rest = trackedOrders().filter((x) => x.order_id !== o.order_id);
  localStorage.setItem(KEY, JSON.stringify([o, ...rest].slice(0, 200)));
}
export function markFinal(id: string) {
  localStorage.setItem(KEY, JSON.stringify(trackedOrders().map((x) => (x.order_id === id ? { ...x, final: true } : x))));
}

/** Journal row for this order's fills so far, or null when nothing filled. */
export function fillRow(t: TrackedOrder, v: OrderView): Insert<JournalEntry> | null {
  if (v.filled <= 0) return null;
  const price = (v.avg_price_cents ?? t.limit_cents) / 100;
  const fee = v.fees_cents / 100 / v.filled;
  return {
    market_id: t.market_id, side_index: t.side_index, outcome: t.outcome, question: t.question,
    category: t.category, niche: t.niche, price, shares: v.filled, fee, placed_at: t.placed_at,
    model_win_prob: t.win_prob, model_edge: t.win_prob == null ? null : t.win_prob - price - fee,
    closing_price: null, result: null, settled_at: null, pnl_usd: null,
    tags: [PAPER_TAG, orderTag(t.order_id)], note: `Kalshi demo (paper) · ${t.ticker} · order ${t.order_id}`,
  };
}

/** Insert or update the journal row for this order. Returns true when My bets changed. */
export async function recordFills(repo: Pick<Repo, "journal">, t: TrackedOrder, v: OrderView): Promise<boolean> {
  const row = fillRow(t, v);
  if (!row) return false;
  const existing = (await repo.journal.list()).find((r) => r.tags.includes(orderTag(t.order_id)));
  if (!existing) { await repo.journal.insert(row); return true; }
  if (existing.shares === row.shares && existing.price === row.price && existing.fee === row.fee) return false;
  await repo.journal.update(existing.id, { shares: row.shares, price: row.price, fee: row.fee, model_edge: row.model_edge });
  return true;
}
