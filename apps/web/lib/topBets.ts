// /about "Best bets right now" (T-291 #13, QA-B #28): the top N by the estimated return the card shows (the US return on a
// US card, lib/betFigures betQuote). Ranked with the same
// shared helper the cards use (betFigures().ret, i.e. cardReturn), on each side as this tier sees it (Free: its band, never the exact number),
// so the order always matches the numbers on screen. One card per game, like Best bets.
import type { Store } from "@/lib/data/store";
import { gateMarket } from "@/lib/data/gate";
import type { Tier } from "@/lib/entitlements";
import { apply, type Row } from "@/lib/filters/apply";
import { FilterState } from "@/lib/filters/state";
import { betFigures } from "@/lib/betFigures";

/** Shown side for a tier, ranked by the card's return (highest first; no return sorts last); one per event. */
export function topByReturn(rows: Row[], n: number, tier: Tier): Row[] {
  const shown = rows.map(({ market, side }) => {
    const m = gateMarket(market, tier);
    const s = m.sides.find((x) => x.side_index === side.side_index) ?? m.best;
    return { row: { market: m, side: s }, roi: betFigures(s, { market: m }).ret.roi, i: 0 };
  });
  shown.forEach((x, i) => (x.i = i));
  shown.sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity) || a.i - b.i);   // stable: ties keep the list order
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const { row } of shown) {
    const ev = row.market.event_id || row.market.id;
    if (seen.has(ev)) continue;
    seen.add(ev);
    out.push(row);
    if (out.length === n) break;
  }
  return out;
}

/** Every row matching `f` (flat pages of 200), so the ranking sees the whole filtered set, not one page. */
export function allRows(store: Store, f: Partial<FilterState>): Row[] {
  const rows: Row[] = [];
  for (let page = 1; ; page++) {
    const p = apply(store, FilterState.parse({ ...f, group_by_event: false, page_size: 200, page }));
    rows.push(...p.rows);
    if (page >= (p.pages ?? 1) || !p.rows.length) return rows;
  }
}
