// Pure trading rules for the extension (docs/16 §3, docs/15 § Trading keys). No chrome.* or fetch here: unit-tested.
// The web app mirrors the intent shape in apps/web/lib/trade/intent.ts. Keep in sync.

/** Paper trading only: the production host is not in this codebase (docs/16 §4). */
export const KALSHI_BASE = "https://external-api.demo.kalshi.co/trade-api/v2";

/** What the web app asks the extension to place. Prices in whole cents, counts in whole contracts. */
export interface OrderIntent {
  ticker: string;
  side: "yes" | "no";
  price_cents: number; // limit price for the side bought, 1–99
  count: number;
  client_order_id: string; // UUID, idempotent retries at Kalshi
}

export interface Caps { maxOrderUsd: number; maxDayUsd: number }
export const DEFAULT_CAPS: Caps = { maxOrderUsd: 25, maxDayUsd: 100 };
export interface Spend { day: string; cents: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER = /^[A-Z0-9][A-Z0-9._-]{1,99}$/i;

/** Validated copy of an untrusted intent, or an error string. */
export function parseIntent(x: unknown): OrderIntent | string {
  const o = x as Partial<OrderIntent> | null;
  if (!o || typeof o !== "object") return "Missing order.";
  if (typeof o.ticker !== "string" || !TICKER.test(o.ticker)) return "Bad market ticker.";
  if (o.side !== "yes" && o.side !== "no") return "Side must be Yes or No.";
  if (!Number.isInteger(o.price_cents) || o.price_cents! < 1 || o.price_cents! > 99) return "Limit price must be 1¢ to 99¢.";
  if (!Number.isInteger(o.count) || o.count! < 1 || o.count! > 100_000) return "Contracts must be a whole number of at least 1.";
  if (typeof o.client_order_id !== "string" || !UUID.test(o.client_order_id)) return "Missing order id.";
  return { ticker: o.ticker, side: o.side, price_cents: o.price_cents!, count: o.count!, client_order_id: o.client_order_id };
}

/**
 * Kalshi fee estimate in cents for `count` contracts at `priceCents`: ceil(0.07 × C × P × (1−P)) to the cent.
 * ponytail: general taker schedule as published before; not re-verified (kalshi.com fee PDF rate-limited us).
 * Some markets differ and resting (maker) fills may cost less, so the UI calls it an estimate.
 */
export function feeCents(count: number, priceCents: number): number {
  const p = priceCents / 100;
  return Math.ceil(+(7 * count * p * (1 - p)).toFixed(6));
}

/** Most this order can cost: the limit price bounds every fill, plus the fee estimate. */
export const maxCostCents = (o: Pick<OrderIntent, "count" | "price_cents">) => o.count * o.price_cents + feeCents(o.count, o.price_cents);

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** Error string when the order breaks a cap, else null. Day spend counts every order placed today (cancelled ones too). */
export function capError(o: OrderIntent, caps: Caps, spend: Spend | undefined, now = new Date()): string | null {
  const cost = maxCostCents(o);
  if (cost > Math.round(caps.maxOrderUsd * 100)) return `This order can cost up to $${(cost / 100).toFixed(2)}, over your $${caps.maxOrderUsd} per-order limit.`;
  const used = spend?.day === today(now) ? spend.cents : 0;
  if (used + cost > Math.round(caps.maxDayUsd * 100))
    return `This order would bring today to $${((used + cost) / 100).toFixed(2)}, over your $${caps.maxDayUsd} daily limit.`;
  return null;
}

/**
 * Kalshi V2 create-order body. V2 books are YES-only: buying YES = bid at p, buying NO at q = ask (sell YES) at 1 − q.
 * Limit + good-till-cancelled; V2 has no buy_max_cost, so the limit price and our caps bound the cost.
 */
export function orderBody(o: OrderIntent) {
  const yesCents = o.side === "yes" ? o.price_cents : 100 - o.price_cents;
  return {
    ticker: o.ticker,
    side: o.side === "yes" ? "bid" : "ask",
    count: `${o.count}.00`,
    price: (yesCents / 100).toFixed(4),
    time_in_force: "good_till_canceled",
    self_trade_prevention_type: "taker_at_cross",
    client_order_id: o.client_order_id,
  };
}

/** Scopes a Kismet key may have: read + write::trade, nothing that writes anything else (docs/15). */
/** RT-09: an allow-list, not a deny-list. Scopes are compared trimmed and lower-cased (Kalshi's reply is untrusted
 *  input); anything other than `read`, `read::…` or `write::trade` (transfer, admin, wildcards, typos) is refused. */
export function scopeError(raw: unknown[]): string | null {
  const scopes = raw.map((s) => String(s).trim().toLowerCase());
  const extra = scopes.filter((s) => !(s === "read" || s === "write::trade" || /^read::[a-z0-9_]+$/.test(s)));
  if (extra.length)
    return `This key also allows ${extra.join(", ")}. For safety Kismet only accepts trade-only keys: create a new key with just "read" and "write::trade".`;
  if (!scopes.includes("read")) return `This key is missing the "read" scope, so Kismet can't show your orders. Create a key with "read" and "write::trade".`;
  if (!scopes.includes("write::trade")) return `This key can't place orders. Create a key with "read" and "write::trade".`;
  return null;
}

export type OrderState = "resting" | "partial" | "filled" | "cancelled";
export interface OrderView {
  order_id: string; ticker: string; side: "yes" | "no"; state: OrderState;
  filled: number; remaining: number;
  avg_price_cents: number | null; // per contract, for the side bought
  fees_cents: number;
}

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));

/** Kalshi GET /portfolio/orders/{id} → what the ticket shows. */
export function orderView(o: Record<string, unknown>): OrderView {
  const side = o.outcome_side === "no" || (o.outcome_side == null && o.book_side === "ask") ? "no" : "yes";
  const filled = num(o.fill_count_fp ?? o.fill_count);
  const remaining = num(o.remaining_count_fp ?? o.remaining_count);
  const cost = num(o.taker_fill_cost_dollars) + num(o.maker_fill_cost_dollars);
  const status = String(o.status);
  const state: OrderState = status === "executed" || (filled > 0 && remaining === 0) ? "filled"
    : status === "canceled" || status === "cancelled" ? "cancelled"
    : filled > 0 ? "partial" : "resting";
  return {
    order_id: String(o.order_id), ticker: String(o.ticker), side, state, filled, remaining,
    avg_price_cents: filled > 0 ? Math.round((cost / filled) * 10000) / 100 : null,
    fees_cents: Math.round((num(o.taker_fees_dollars) + num(o.maker_fees_dollars)) * 100),
  };
}

export interface Quote {
  ticker: string; title: string; status: string;
  yes_ask: number | null; no_ask: number | null; // cents
  /** Contracts offered per side as [ask cents, count], cheapest first (from the other side's bids). */
  asks: { yes: [number, number][]; no: [number, number][] };
}

const cents = (c: unknown, d: unknown) => (c != null && c !== "" ? Number(c) : d != null && d !== "" ? Math.round(Number(d) * 100) : null);
const levels = (xs: unknown): [number, number][] =>
  Array.isArray(xs) ? xs.map((l) => [Number(l[0]), Number(l[1])] as [number, number]).filter(([p, n]) => p > 0 && n > 0) : [];

/** Kalshi market + orderbook (old cents or new *_dollars fields) → Quote. Asks on one side = 100 − bids on the other. */
export function toQuote(market: Record<string, unknown>, book: Record<string, unknown> | null): Quote {
  const ob = (book?.orderbook ?? {}) as Record<string, unknown>;
  const fp = (book?.orderbook_fp ?? {}) as Record<string, unknown>;
  const bids = (k: "yes" | "no") =>
    ob[k] ? levels(ob[k]) : levels(fp[`${k}_dollars`]).map(([p, n]) => [Math.round(p * 100), n] as [number, number]);
  const asks = (other: "yes" | "no") => bids(other).map(([p, n]) => [100 - p, n] as [number, number]).sort((a, b) => a[0] - b[0]);
  return {
    ticker: String(market.ticker), title: String(market.title ?? market.yes_sub_title ?? market.ticker), status: String(market.status ?? ""),
    yes_ask: cents(market.yes_ask, market.yes_ask_dollars), no_ask: cents(market.no_ask, market.no_ask_dollars),
    asks: { yes: asks("no"), no: asks("yes") },
  };
}
