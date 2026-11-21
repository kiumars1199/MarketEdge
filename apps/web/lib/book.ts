// Live CLOB order book, server only (docs/07-execution.md). Shared by /api/book and the alerts cron.
import { check, feeRate, type Book } from "@/lib/execution";
import type { Execution } from "@/lib/types";

const CLOB = "https://clob.polymarket.com";
const TTL_MS = 5_000;
export const MIN_EDGE = 0.02; // config flag_min_edge

// ponytail: per-instance in-memory cache, unbounded by token count; LRU/shared cache if traffic grows
const cache = new Map<string, { at: number; book: Book | null }>();

export async function getBook(token: string): Promise<{ at: number; book: Book | null }> {
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const res = await fetch(`${CLOB}/books`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ token_id: token }]),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`order book request failed: HTTP ${res.status}`);
  const data = (await res.json()) as (Book & { asset_id?: string })[] | null;
  const book = (Array.isArray(data) ? data : []).find((b) => b?.asset_id === token) ?? null;
  const entry = { at: Date.now(), book };
  cache.set(token, entry);
  return entry;
}

/** Execution check against the live book, or null when there is no usable book. */
export async function liveExecution(token: string, q: number, cat: string): Promise<(Execution & { book_ok: true }) | null> {
  const { book } = await getBook(token);
  if (!book) return null;
  const ex = check(q, book, feeRate(cat), MIN_EDGE);
  return ex.book_ok ? (ex as Execution & { book_ok: true }) : null;
}
