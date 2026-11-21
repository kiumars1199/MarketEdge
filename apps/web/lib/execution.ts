// Exact port of engine/execution.py (see docs/07-execution.md). Must match
// engine/tests/fixtures/book_expected.json; keep in lockstep with the Python.
import type { Category, Execution, StakeRow } from "@/lib/types";

export const STAKES = [25, 100, 500, 1000];

// pipeline/common.py FEE_RATE: Polymarket taker fee rate by category. fee/share = rate * p * (1 - p).
export const FEE_RATE: Record<Category, number> = {
  crypto: 0.07, sports: 0.05, finance: 0.04, politics: 0.04,
  culture: 0.05, weather: 0.05, tech: 0.04, geopolitics: 0.0,
  other: 0.05,
};
export const feeRate = (cat: string | null | undefined): number =>
  cat && Object.hasOwn(FEE_RATE, cat) ? FEE_RATE[cat as Category] : 0.05;

// engine/scan.py: added when the model edge is >= 15c.
export const EDGE_WARNING =
  "Edge looks too good: in testing, flags above 15c earned far less than predicted.";
export const edgeWarning = (edge: number): string | undefined =>
  edge >= 0.15 ? EDGE_WARNING : undefined;

export type BookLevel = { price: string | number; size: string | number };
export type Book = { bids?: BookLevel[] | null; asks?: BookLevel[] | null };
type Level = [price: number, size: number];
export type NoSellers = { verdict: "no sellers"; book_ok: false };
export type CheckResult = Execution | NoSellers;
export type Fill = { shares: number; avg_price: number; avg_fee: number; filled_usd: number };

/**
 * Python's round(x, n): rounds the exact binary value, ties (exact only) to even.
 * toFixed rounds the exact value too, but breaks ties away from zero, so ties are fixed by hand.
 */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e15) return x;
  const exact = Math.abs(x).toFixed(100); // exact decimal expansion for doubles in this range
  const [ip, fp] = exact.split(".") as [string, string];
  const rest = fp.slice(n);
  const keep = ip + fp.slice(0, n);
  // ponytail: Number(keep) is exact below 2^53, fine for prices/USD; BigInt if ever needed above
  let k = Number(keep);
  const tie = rest[0] === "5" && !/[1-9]/.test(rest.slice(1));
  if (tie ? k % 2 === 1 : rest[0]! >= "5") k += 1;
  const r = Number(`${k}e-${n}`);
  return x < 0 ? -r : r;
}

function levels(book: Book, side: "bids" | "asks"): Level[] {
  const lv: Level[] = (book[side] || []).map((x) => [Number(x.price), Number(x.size)]);
  return lv.sort((a, b) => (side === "bids" ? b[0] - a[0] : a[0] - b[0]));
}

/** Market-buy `dollars` worth (including fee). Returns shares, avg price, avg fee. */
export function fill(asks: Level[], dollars: number, fee_rate: number): Fill | null {
  let shares = 0, cost = 0, fees = 0;
  let left = dollars;
  for (const [price, size] of asks) {
    const fee = fee_rate * price * (1 - price);
    const per_share = price + fee;
    const take = Math.min(size, left / per_share);
    if (take <= 0) break;
    shares += take;
    cost += take * price;
    fees += take * fee;
    left -= take * per_share;
    if (left <= 1e-9) break;
  }
  if (shares === 0) return null;
  return { shares, avg_price: cost / shares, avg_fee: fees / shares, filled_usd: dollars - left };
}

/** Dollars spendable while each marginal share still has edge >= min_edge. */
export function capacity(asks: Level[], q: number, fee_rate: number, min_edge: number): number {
  let usd = 0;
  for (const [price, size] of asks) {
    const fee = fee_rate * price * (1 - price);
    if (q - price - fee < min_edge) break;
    usd += size * (price + fee);
  }
  return usd;
}

export function check(
  q: number, book: Book, fee_rate: number, min_edge: number,
  opts: { tick?: number; stakes?: number[] } = {},
): CheckResult {
  const tick = opts.tick ?? 0.01;
  const asks = levels(book, "asks"), bids = levels(book, "bids");
  if (!asks.length) return { verdict: "no sellers", book_ok: false };
  const best_ask = asks[0]![0];
  const best_bid = bids.length ? bids[0]![0] : null;
  const mid = best_bid !== null ? (best_ask + best_bid) / 2 : best_ask;
  const fee = fee_rate * best_ask * (1 - best_ask);
  const gross = q - mid;
  const net = q - best_ask - fee;
  const retention = gross > 0 ? net / gross : 0;
  const stakes: StakeRow[] = [];
  for (const usd of opts.stakes ?? STAKES) {
    const f = fill(asks, usd, fee_rate);
    if (!f) continue;
    const e = q - f.avg_price - f.avg_fee;
    stakes.push({
      stake_usd: usd, filled_usd: pyRound(f.filled_usd, 2),
      shares: pyRound(f.shares, 2), avg_price: pyRound(f.avg_price, 4),
      edge: pyRound(e, 4),
      expected_profit_usd: pyRound(e * f.shares, 2),
      roi_pct: pyRound((e / (f.avg_price + f.avg_fee)) * 100, 2),
    });
  }
  // `||` on purpose: Python `best_bid or 0` treats a 0.0 bid as missing.
  const limit_price = pyRound(Math.min(best_ask - tick, (best_bid || 0) + tick), 4);
  const verdict = net >= min_edge && retention >= 0.5 ? "worth it" : net > 0 ? "thin" : "not worth it";
  return {
    book_ok: true, best_bid, best_ask, book_mid: pyRound(mid, 4),
    spread: pyRound(best_ask - (best_bid || best_ask), 4), spread_cost: pyRound(best_ask - mid, 4),
    fee_at_ask: pyRound(fee, 4), gross_edge: pyRound(gross, 4), net_edge: pyRound(net, 4),
    retention: pyRound(retention, 3), capacity_usd: pyRound(capacity(asks, q, fee_rate, min_edge), 2),
    stakes, limit_price, limit_edge: pyRound(q - limit_price, 4),
    verdict,
  };
}
