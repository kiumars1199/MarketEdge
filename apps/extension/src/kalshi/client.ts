// Signed calls to Kalshi's DEMO exchange from the background worker. Errors carry Kalshi's message only,
// never request headers or key material (docs/15: keys never reach logs or error reports).
import { authHeaders } from "./sign";
import { KALSHI_BASE, orderBody, type OrderIntent } from "./trade";

export interface Signer { keyId: string; key: CryptoKey }

export class KalshiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function call<T>(signer: Signer | null, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const url = `${KALSHI_BASE}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  if (signer) Object.assign(headers, await authHeaders(signer.keyId, signer.key, method, url));
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "omit" });
  } catch {
    throw new KalshiError(0, "Couldn't reach Kalshi's demo exchange. Check your connection and try again.");
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const e = (json as { error?: { message?: string; code?: string } } | null)?.error;
    const msg = res.status === 401 ? "Kalshi didn't accept this key (check the key ID and that it's a demo key)."
      : res.status === 403 ? `Kalshi says this key lacks a permission${e?.code ? ` (${e.code})` : ""}.`
      : res.status === 429 ? "Kalshi is rate-limiting requests. Wait a few seconds and try again."
      : e?.message || `Kalshi answered ${res.status}.`;
    throw new KalshiError(res.status, msg);
  }
  return json as T;
}

const q = encodeURIComponent;

export const getApiKeys = (s: Signer) => call<{ api_keys: { api_key_id: string; scopes: string[] }[] }>(s, "GET", "/api_keys");
export const getBalance = (s: Signer) => call<{ balance: number; portfolio_value?: number }>(s, "GET", "/portfolio/balance");
export const getMarket = (ticker: string) => call<{ market: Record<string, unknown> }>(null, "GET", `/markets/${q(ticker)}`);
export const getOrderbook = (ticker: string) => call<Record<string, unknown>>(null, "GET", `/markets/${q(ticker)}/orderbook`);
export const getOrder = (s: Signer, id: string) => call<{ order: Record<string, unknown> }>(s, "GET", `/portfolio/orders/${q(id)}`);
export const listResting = (s: Signer) => call<{ orders: Record<string, unknown>[] }>(s, "GET", "/portfolio/orders?status=resting");
export const listPositions = (s: Signer) => call<{ market_positions?: Record<string, unknown>[] }>(s, "GET", "/portfolio/positions");
export const cancelOrder = (s: Signer, id: string, ticker: string) =>
  call<unknown>(s, "DELETE", `/portfolio/events/orders/${q(id)}?market_ticker=${q(ticker)}`);

/** The ONLY function that creates an order. Called only from the "place" intent handler in background.ts (test/no-auto-trade.test.ts). */
export const placeOrder = (s: Signer, o: OrderIntent) =>
  call<{ order_id: string; fill_count: string; remaining_count: string }>(s, "POST", "/portfolio/events/orders", orderBody(o));
