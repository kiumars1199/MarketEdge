// Market settlement from Polymarket (Gamma + CLOB prices-history), server only.
// Shared by POST /api/settle (demo journal in the browser) and the /api/settle/run cron (Supabase journal).
// winner null + resolved = void (50/50). closing price = each side's last trade before the market's end, for CLV.
import type { SupabaseClient } from "@supabase/supabase-js";
import { settlePatch, type Settlement } from "@/lib/journal";
import type { JournalEntry } from "@/lib/repo/types";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const TTL_MS = 10 * 60_000;


// ponytail: per-instance memory cache; resolved results never change, open ones re-check after TTL
const cache = new Map<string, { at: number; v: Settlement }>();
const OPEN: Settlement = { resolved: false, winner_side_index: null, closing_prices: [null, null] };

const arr = (x: unknown): string[] => {
  if (Array.isArray(x)) return x.map(String);
  try { const v = JSON.parse(String(x)); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function closingPrice(token: string | undefined, endSec: number): Promise<number | null> {
  if (!token) return null;
  try {
    const { history } = await json<{ history?: { t: number; p: number }[] }>(
      `${CLOB}/prices-history?${new URLSearchParams({ market: token, interval: "max", fidelity: "60" })}`);
    const before = (history ?? []).filter((h) => h.t <= endSec && Number.isFinite(h.p));
    return before.length ? before[before.length - 1]!.p : null;
  } catch {
    return null; // CLV skipped when history is unavailable
  }
}

export async function settleOne(id: string): Promise<Settlement> {
  const hit = cache.get(id);
  if (hit && (hit.v.resolved || Date.now() - hit.at < TTL_MS)) return hit.v;
  try {
    const m = await json<Record<string, unknown>>(`${GAMMA}/markets/${encodeURIComponent(id)}`);
    const prices = arr(m.outcomePrices).map(Number);
    const closed = m.closed === true;
    const uma = String(m.umaResolutionStatus ?? "");
    const resolved = closed && prices.length === 2 && (uma === "" || uma === "resolved") &&
      (prices.some((p) => p >= 0.99) || prices.every((p) => Math.abs(p - 0.5) < 0.01));
    let v: Settlement = OPEN;
    if (resolved) {
      const win = prices.findIndex((p) => p >= 0.99);
      const end = Date.parse(String(m.endDate ?? m.closedTime ?? "")) / 1000;
      const closedAt = Date.parse(String(m.closedTime ?? "").replace(" ", "T").replace(/\+00$/, "Z")) / 1000;
      const cutoff = Math.min(...[end, closedAt].filter(Number.isFinite), Date.now() / 1000);
      const tokens = arr(m.clobTokenIds);
      const [c0, c1] = await Promise.all([closingPrice(tokens[0], cutoff), closingPrice(tokens[1], cutoff)]);
      v = { resolved: true, winner_side_index: win === 0 || win === 1 ? win : null, closing_prices: [c0, c1] };
    }
    cache.set(id, { at: Date.now(), v });
    return v;
  } catch {
    return OPEN; // unknown market or Gamma down: try again next load
  }
}

type Row = JournalEntry & { user_id: string };

/**
 * Settles every user's open journal rows (service role). Patches only what changed, so a second run is a no-op.
 * ponytail: up to 1000 rows per run, oldest first; page through if journals outgrow that.
 */
export async function settleJournal(db: SupabaseClient, now = new Date(), settle = settleOne):
  Promise<{ rows: number; markets: number; updated: number; failed: number }> {
  const { data, error } = await db.from("journal").select("*")
    .or("result.is.null,closing_price.is.null").order("placed_at", { ascending: true }).limit(1000);
  if (error) throw new Error(`journal read failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.market_id))];
  const byId = new Map<string, Settlement>();
  for (let i = 0; i < ids.length; i += 8) {   // 8 concurrent Gamma calls
    const chunk = ids.slice(i, i + 8);
    const res = await Promise.all(chunk.map(settle));
    chunk.forEach((id, j) => byId.set(id, res[j]!));
  }
  let updated = 0, failed = 0;
  for (const r of rows) {
    const row = { ...r, price: Number(r.price), shares: Number(r.shares), fee: Number(r.fee ?? 0),
      closing_price: r.closing_price == null ? null : Number(r.closing_price) };
    const patch = settlePatch(row, byId.get(r.market_id), now);
    if (!patch) continue;
    let q = db.from("journal").update(patch).eq("id", r.id).eq("user_id", r.user_id);
    if (patch.result) q = q.is("result", null);   // never overwrite a result set meanwhile
    const { error: e } = await q;
    if (e) failed++; else updated++;
  }
  return { rows: rows.length, markets: ids.length, updated, failed };
}
