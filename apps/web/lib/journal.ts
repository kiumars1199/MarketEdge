// My bets math (docs/05 F-12). `price` and `fee` are per share (0–1), payout $1/share.
//   won  pnl =  shares × (1 − price − fee)
//   lost pnl = −shares × (price + fee)
//   void pnl = 0 (stake returned)
//   CLV = closing_price − price
import type { JournalEntry, Patch } from "@/lib/repo/types";
import { cell } from "@/lib/csv";

export type Result = NonNullable<JournalEntry["result"]>;
type Bet = Pick<JournalEntry, "price" | "shares" | "fee">;

export const stake = (b: Bet) => b.shares * (b.price + b.fee);

export function pnl(b: Bet, result: Result): number {
  if (result === "won") return b.shares * (1 - b.price - b.fee);
  if (result === "lost") return -b.shares * (b.price + b.fee);
  return 0;
}

export const clv = (b: Pick<JournalEntry, "price" | "closing_price">): number | null =>
  b.closing_price == null ? null : b.closing_price - b.price;

/** estimated return at entry, roi % (model edge per share ÷ cost per share) */
export const entryReturn = (b: Pick<JournalEntry, "price" | "fee" | "model_edge">): number | null =>
  b.model_edge == null || b.price + b.fee <= 0 ? null : (b.model_edge / (b.price + b.fee)) * 100;

export interface Settlement { resolved: boolean; winner_side_index: 0 | 1 | null; closing_prices: [number | null, number | null] }

/** Patch for a journal row from /api/settle, or null when nothing changes. */
export function settlePatch(e: JournalEntry, s: Settlement | undefined, now = new Date()): Patch<JournalEntry> | null {
  if (!s) return null;
  const closing = s.closing_prices[e.side_index] ?? null;
  const p: Patch<JournalEntry> = {};
  if (closing !== null && e.closing_price !== closing) p.closing_price = closing;
  if (s.resolved && e.result === null) {
    const result: Result = s.winner_side_index === null ? "void" : s.winner_side_index === e.side_index ? "won" : "lost";
    Object.assign(p, { result, pnl_usd: pnl(e, result), settled_at: now.toISOString() });
  }
  return Object.keys(p).length ? p : null;
}

export interface Summary {
  bets: number; open: number; settled: number; staked: number; pnl: number;
  roi: number | null; win_rate: number | null; avg_clv: number | null; avg_entry_return: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(rows: JournalEntry[]): Summary {
  const settled = rows.filter((r) => r.result !== null);
  const decided = settled.filter((r) => r.result !== "void");
  const settledStake = settled.filter((r) => r.result !== "void").reduce((a, r) => a + stake(r), 0);
  const total = settled.reduce((a, r) => a + (r.pnl_usd ?? pnl(r, r.result!)), 0);
  return {
    bets: rows.length,
    open: rows.length - settled.length,
    settled: settled.length,
    staked: rows.reduce((a, r) => a + stake(r), 0),
    pnl: total,
    roi: settledStake > 0 ? (total / settledStake) * 100 : null,
    win_rate: decided.length ? decided.filter((r) => r.result === "won").length / decided.length : null,
    avg_clv: mean(rows.map(clv).filter((x): x is number => x !== null)),
    avg_entry_return: mean(rows.map(entryReturn).filter((x): x is number => x !== null)),
  };
}

/** Settled bets in date order with running realized and expected (model edge × shares) P&L. */
export function cumulative(rows: JournalEntry[]) {
  let real = 0, exp = 0;
  return rows
    .filter((r) => r.result !== null)
    .sort((a, b) => (a.settled_at ?? a.placed_at).localeCompare(b.settled_at ?? b.placed_at))
    .map((r, i) => {
      real += r.pnl_usd ?? pnl(r, r.result!);
      exp += r.result === "void" ? 0 : (r.model_edge ?? 0) * r.shares;
      return { n: i + 1, date: r.settled_at ?? r.placed_at, pnl: real, expected: exp };
    });
}

export function byTopic(rows: JournalEntry[]) {
  const m = new Map<string, number>();
  for (const r of rows) if (r.result) m.set(r.niche ?? r.category ?? "other", (m.get(r.niche ?? r.category ?? "other") ?? 0) + (r.pnl_usd ?? 0));
  return [...m].map(([topic, pnl]) => ({ topic, pnl })).sort((a, b) => b.pnl - a.pnl);
}

/** Date in the user's time zone: "Nov 16, 2026". */
export function day(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try { return d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }); }
  catch { return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
}

// CSV: one row per bet, header = these columns.
const CSV_COLS = [
  "market_id", "side_index", "outcome", "question", "category", "niche", "price", "shares", "fee", "placed_at",
  "model_win_prob", "model_edge", "closing_price", "result", "settled_at", "pnl_usd", "note",
] as const;


export const toCsv = (rows: JournalEntry[]) =>
  [CSV_COLS.join(","), ...rows.map((r) => CSV_COLS.map((c) => cell(r[c])).join(","))].join("\n");

function parseCsvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (ch === '"') q = false;
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); out.push(row); row = []; f = "";
    } else f += ch;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

export type JournalImport = Omit<JournalEntry, "id">;

/** Parse a CSV in the export format. Rows without market_id, side, price or shares are skipped. */
export function fromCsv(text: string): { rows: JournalImport[]; skipped: number } {
  const [head, ...body] = parseCsvRows(text);
  if (!head) return { rows: [], skipped: 0 };
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const get = (r: string[], k: string) => {
    const v = r[idx[k] ?? -1]?.trim().replace(/^'(?=[=+\-@])/, "");   // undo the export's formula guard (lib/csv cell)
    return v === undefined || v === "" ? null : v;
  };
  const num = (r: string[], k: string) => { const v = get(r, k); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
  const rows: JournalImport[] = [];
  let skipped = 0;
  for (const r of body) {
    const market_id = get(r, "market_id"), side = num(r, "side_index"), price = num(r, "price"), shares = num(r, "shares");
    const result = get(r, "result");
    if (!market_id || (side !== 0 && side !== 1) || price === null || !(price > 0 && price < 1) || shares === null || shares <= 0) { skipped++; continue; }
    const placed = get(r, "placed_at");
    rows.push({
      market_id, side_index: side, outcome: get(r, "outcome"), question: get(r, "question"),
      category: get(r, "category"), niche: get(r, "niche"), price, shares, fee: num(r, "fee") ?? 0,
      placed_at: placed && !Number.isNaN(Date.parse(placed)) ? new Date(placed).toISOString() : new Date().toISOString(),
      model_win_prob: num(r, "model_win_prob"), model_edge: num(r, "model_edge"), closing_price: num(r, "closing_price"),
      result: result === "won" || result === "lost" || result === "void" ? result : null,
      settled_at: get(r, "settled_at"), pnl_usd: num(r, "pnl_usd"), tags: [], note: get(r, "note"),
    });
  }
  return { rows, skipped };
}
