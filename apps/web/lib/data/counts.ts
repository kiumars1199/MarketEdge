// T-288: the one Best bets count. /status, /about, admin health, the landing page, Best bets (/ and /bets, whose
// unfiltered headline runs this same query through listBody) and the Free sample ("N more on Pro") all count
// with these functions, so one scan gives one number on every page and every reload.
import { apply, type Row } from "@/lib/filters/apply";
import { BEST_BETS_VERDICTS, FilterState } from "@/lib/filters/state";
import { FREE_BEST_BETS_A_DAY } from "@/lib/entitlements";
import { liveBase } from "@/lib/proof";
import type { LedgerSummary } from "@/lib/types";
import type { Store } from "./store";

/** The Best bets page's own query with no filters touched: best tier, price check "worth it" or "thin", the default
 *  40% chance floor, open markets only (apply drops closed ones at the request clock). */
export const bestBetsQuery = (patch: Partial<FilterState> = {}): FilterState =>
  FilterState.parse({ view: "flags", verdicts: BEST_BETS_VERDICTS, ...patch });

/** Every row of the unfiltered Best bets list, in page order (flat, one page holding them all). With US coverage in
 *  the scan that is the "On Polymarket US" set (FilterState.us defaults on, lib/filters/us.ts). */
export const bestBetsRows = (store: Store, patch: Partial<FilterState> = {}): Row[] =>
  apply(store, { ...bestBetsQuery({ group_by_event: false, ...patch }), page: 1, page_size: Number.MAX_SAFE_INTEGER }).rows;

export type BestBetsSection = (typeof BEST_BETS_VERDICTS)[number];
export interface BestBetsCount {
  total: number;
  /** Price-check sections of the list; they always add up to `total`. */
  sections: Record<BestBetsSection, number>;
}

const usEnough = new WeakMap<Store, boolean>();
/** T-302 (docs/OVERHAUL.md §G2): Free's daily 10 come from the "On Polymarket US" set when it holds at least 10 bets;
 *  with fewer, the sample (and the Free list it filters) falls back to every Best bet so Free still gets 10. */
export function freeUsOn(store: Store): boolean {
  let v = usEnough.get(store);
  if (v === undefined) usEnough.set(store, (v = bestBetsRows(store).length >= FREE_BEST_BETS_A_DAY));
  return v;
}

/** Best bets right now in this store, and how they split by price check. `free`: count the way the Free list does
 *  (QA-A, Marc #26/#57: with under 10 US bets Free's list widens to every venue, so /status must count that set too). */
export function bestBetsCount(store: Store, opts: { free?: boolean } = {}): BestBetsCount {
  const rows = bestBetsRows(store, opts.free ? { us: freeUsOn(store) } : {});
  const sections = Object.fromEntries(BEST_BETS_VERDICTS.map((v) => [v, 0])) as Record<BestBetsSection, number>;
  for (const r of rows) {
    const v = r.market.execution?.verdict as BestBetsSection | undefined;
    if (v && v in sections) sections[v]++;
  }
  return { total: rows.length, sections };
}

export interface SettledCount {
  /** best bets logged, each once */
  logged: number;
  /** settled = won + lost + void */
  settled: number;
  won: number;
  lost: number;
  /** settled but neither won nor lost (voided, refunded); 0 in practice */
  void: number;
}

/** QA-A (Marc #49/#63): the one live-record count. Each bet once (`liveBase`: re-shows at a lower price dropped), the
 *  same base /track-record and Results use, so /status, /api/meta and /track-record never disagree. Its parts add up
 *  to `settled`. */
export function settledCount(l: LedgerSummary | null | undefined): SettledCount | null {
  const b = liveBase(l);
  if (!b) return null;
  return { logged: b.entries, settled: b.graded, won: b.wins, lost: b.losses, void: Math.max(0, b.graded - b.wins - b.losses) };
}
