// Order intent + ticket math, shared by the ticket (client) and the nonce routes (server).
// Mirrors apps/extension/src/kalshi/trade.ts (the extension re-validates everything). Keep in sync.
import "@/lib/zod-jitless";
import { z } from "zod";

export const KALSHI_RISK_URL = "https://kalshi.com/regulatory";
export { kalshiMarketUrl } from "./urls";

export const Ticker = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,99}$/i, "Bad market ticker");
export const OrderIntent = z.object({
  ticker: Ticker,
  side: z.enum(["yes", "no"]),
  price_cents: z.number().int().min(1).max(99),
  count: z.number().int().min(1).max(100_000),
  client_order_id: z.uuid(),
}).strict();
export type OrderIntent = z.infer<typeof OrderIntent>;
export const CancelIntent = z.object({ order_id: z.string().min(1).max(100), ticker: Ticker }).strict();

export const NonceRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("place"), payload: OrderIntent }).strict(),
  z.object({ action: z.literal("cancel"), payload: CancelIntent }).strict(),
]);

/** Kalshi fee estimate (cents): ceil(0.07 × C × P × (1 − P)). Taker schedule; labelled an estimate in the UI. */
export function feeCents(count: number, priceCents: number): number {
  const p = priceCents / 100;
  return Math.ceil(+(7 * count * p * (1 - p)).toFixed(6));
}

export interface TicketMath {
  count: number; costCents: number; feeCents: number; maxCostCents: number;
  payoutCents: number;          // if it wins: $1 per contract
  roiPct: number | null;        // Kismet estimated return at this price (model win chance vs cost incl. fee)
}

/** Contracts for $ amount at a limit, or the count given; plus what the ticket shows. */
export function ticketMath(mode: "usd" | "contracts", amount: number, priceCents: number, winProb: number | null): TicketMath | null {
  if (!(priceCents >= 1 && priceCents <= 99) || !(amount > 0)) return null;
  let count = mode === "contracts" ? Math.floor(amount) : Math.floor((amount * 100) / priceCents);
  // in $ mode, keep the total (cost + fee) inside the amount
  while (mode === "usd" && count > 0 && count * priceCents + feeCents(count, priceCents) > amount * 100) count--;
  if (count < 1) return null;
  const fee = feeCents(count, priceCents);
  const cost = count * priceCents;
  const perShare = (cost + fee) / count / 100;
  return {
    count, costCents: cost, feeCents: fee, maxCostCents: cost + fee, payoutCents: count * 100,
    roiPct: winProb == null ? null : ((winProb - perShare) / perShare) * 100,
  };
}

/** Contracts you could buy now at or under the limit, from Kalshi's book: [ask cents, count][] cheapest first. */
export function fillableNow(asks: [number, number][], limitCents: number, want: number) {
  let n = 0, cost = 0;
  for (const [p, c] of asks) {
    if (p > limitCents || n >= want) break;
    const take = Math.min(c, want - n);
    n += take;
    cost += take * p;
  }
  return { now: n, rests: want - n, avgCents: n ? cost / n : null };
}
