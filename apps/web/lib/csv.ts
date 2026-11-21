// CSV export of the current view (docs/05 F-18): plain-language columns first, then pro columns. Max 5,000 rows.
import type { ApiRow, MarketsResponse } from "@/lib/api";
import { betLine, closesIn, expectedProfit, money, pct, price, ret } from "@/lib/format";
import { sideChance } from "@/lib/betFigures";

export const MAX_ROWS = 5000;

const COLUMNS: [header: string, cell: (r: ApiRow) => unknown][] = [
  ["Question", (r) => r.market.question],
  ["Event", (r) => r.market.event],
  ["Bet", (r) => betLine(r.side)],
  ["Estimated return", (r) => ret(r.side.roi_pct)],
  ["Past results per $100 bet", (r) => money(expectedProfit(r.side.roi_pct), true)],
  ["Market says", (r) => pct(r.side.ask)],
  ["Won before", (r) => pct(r.side.win_prob)],
  ["Chance", (r) => sideChance(r.side)],
  ["Price", (r) => price(r.side.ask)],
  ["Closes in", (r) => closesIn(r.market.closes_at)],
  ["Category", (r) => r.market.category],
  ["Link", (r) => r.market.url],
  // pro columns: raw numbers for spreadsheets
  ["market_id", (r) => r.market.id],
  ["side_index", (r) => r.side.side_index],
  ["ask", (r) => r.side.ask],
  ["mid", (r) => r.side.mid],
  ["fee", (r) => r.side.fee],
  ["win_prob", (r) => r.side.win_prob],
  ["win_prob_low", (r) => r.side.win_prob_low],
  ["edge", (r) => r.side.edge],
  ["edge_low", (r) => r.side.edge_low],
  ["roi_pct", (r) => r.side.roi_pct],
  ["realistic_edge", (r) => r.side.realistic_edge],
  ["model_level", (r) => r.side.model_level],
  ["model_events", (r) => r.side.model_events],
  ["niche", (r) => r.market.niche],
  ["market_type", (r) => r.market.market_type],
  ["validated", (r) => r.market.validated],
  ["volume", (r) => r.market.volume],
  ["liquidity", (r) => r.market.liquidity],
  ["spread", (r) => r.market.spread],
  ["closes_at_utc", (r) => new Date(r.market.closes_at * 1000).toISOString()],
  ["verdict", (r) => r.market.execution?.verdict],
  ["capacity_usd", (r) => r.market.execution?.capacity_usd],
];

/** A text cell starting with one of these runs as a formula in a spreadsheet (RT3-04). */
export const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 cell: quote when it holds a comma, quote or line break; missing/NaN → empty. Text that would start a
 *  formula (= + - @ tab CR) gets a leading ' so it shows as text (RT3-04); numbers stay numbers (-0.05 is data). */
export function cell(v: unknown): string {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = typeof v === "string" && FORMULA_START.test(v) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text (header + at most MAX_ROWS rows), CRLF line ends. */
export function toCsv(rows: ApiRow[]): string {
  return [COLUMNS.map(([h]) => cell(h)), ...rows.slice(0, MAX_ROWS).map((r) => COLUMNS.map(([, f]) => cell(f(r))))]
    .map((line) => line.join(","))
    .join("\r\n");
}

/** Pull pages until `cap` rows or the last page. */
export async function collectRows(fetchPage: (page: number) => Promise<MarketsResponse>, cap = MAX_ROWS): Promise<ApiRow[]> {
  const out: ApiRow[] = [];
  for (let page = 1; out.length < cap; page++) {
    const res = await fetchPage(page);
    out.push(...res.rows);
    if (page >= res.pages || !res.rows.length) break;
  }
  return out.slice(0, cap);
}
