// Kalshi combo check (docs/18 §5.3): find Kalshi's own combo market for the chosen legs and read its ask.
// Off by default: Kalshi's Developer Agreement bars commercial reuse of its data without written permission
// (docs/16 §2), so it runs only when KALSHI_DATA_PERMISSION=true. Server only. Public market-data endpoints, no key.
// Endpoints (docs/18 §5): GET /markets/{ticker}, GET /multivariate_event_collections,
// POST /multivariate_event_collections/{ticker}/lookup, then GET /markets/{combo ticker} for the quote.
import "@/lib/zod-jitless";
import { z } from "zod";
import { Ticker } from "@/lib/trade/intent";

export const kalshiDataEnabled = () => process.env.KALSHI_DATA_PERMISSION === "true";
/** Demo exchange while paper trading is on (so a combo found here can be paper-traded), else production data. */
const kalshiBase = () =>
  process.env.KALSHI_TRADING_ENV === "demo" ? "https://demo-api.kalshi.co/trade-api/v2" : "https://api.elections.kalshi.com/trade-api/v2";

export const ComboCheckBody = z.object({
  legs: z.array(z.object({ ticker: Ticker, side: z.enum(["yes", "no"]) }).strict()).min(2).max(6),
}).strict();
export type ComboCheckBody = z.infer<typeof ComboCheckBody>;
export type ComboQuote = { ok: true; ticker: string; ask_cents: number } | { ok: false; error: string };

type Fetch = typeof fetch;
const json = async (f: Fetch, url: string, init?: RequestInit) => {
  const r = await f(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) } });
  if (!r.ok) throw new Error(`Kalshi ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
};
const cents = (m: Record<string, unknown>): number | null => {
  if (typeof m.yes_ask === "number" && m.yes_ask > 0) return m.yes_ask;
  const d = Number(m.yes_ask_dollars);
  return Number.isFinite(d) && d > 0 ? Math.round(d * 100) : null;
};

export async function lookupCombo({ legs }: ComboCheckBody, f: Fetch = fetch, base = kalshiBase()): Promise<ComboQuote> {
  try {
    const events = await Promise.all(legs.map(async (l) => {
      const m = (await json(f, `${base}/markets/${encodeURIComponent(l.ticker)}`)).market as Record<string, unknown> | undefined;
      return typeof m?.event_ticker === "string" ? m.event_ticker : null;
    }));
    if (events.some((e) => !e)) return { ok: false, error: "A leg isn't an open Kalshi market." };
    if (new Set(events).size < events.length) return { ok: false, error: "Two legs share a Kalshi event; combos need different events." };

    const body = await json(f, `${base}/multivariate_event_collections?status=open&limit=200`);
    // ponytail: first page only (200 collections); page with `cursor` if Kalshi grows past that
    const list = ((body.multivariate_contracts ?? body.collections) as Record<string, unknown>[] | undefined) ?? [];
    const has = (c: Record<string, unknown>, ev: string) =>
      Array.isArray(c.associated_events) && c.associated_events.some((a) => (a as { ticker?: string }).ticker === ev);
    const coll = list.find((c) => events.every((ev) => has(c, ev!)));
    if (!coll || typeof coll.collection_ticker !== "string") return { ok: false, error: "Kalshi has no combo that covers these legs." };

    const found = await json(f, `${base}/multivariate_event_collections/${encodeURIComponent(coll.collection_ticker)}/lookup`, {
      method: "POST",
      body: JSON.stringify({ selected_markets: legs.map((l, i) => ({ event_ticker: events[i], market_ticker: l.ticker, side: l.side })) }),
    });
    const ticker = found.market_ticker;
    if (typeof ticker !== "string" || !Ticker.safeParse(ticker).success) return { ok: false, error: "Kalshi didn't return a combo market." };
    const quote = (await json(f, `${base}/markets/${encodeURIComponent(ticker)}`)).market as Record<string, unknown> | undefined;
    const ask = quote ? cents(quote) : null;
    return ask ? { ok: true, ticker, ask_cents: ask } : { ok: false, error: "No one is selling this combo on Kalshi right now." };
  } catch (e) {
    console.warn("[kalshi combo]", (e as Error).message);
    return { ok: false, error: "Couldn't reach Kalshi. Try again in a minute." };
  }
}
