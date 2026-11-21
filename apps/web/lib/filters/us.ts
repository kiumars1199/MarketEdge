// "On Polymarket US" (docs/OVERHAUL.md §G2): the one predicate for a bet US users can place at a price that is still
// worth it after the US fee. Best bets, every count, the Free daily sample and lane C's top.json use this same test.
import type { Market, ScanMeta } from "@/lib/types";

/** Listed on Polymarket US with a live price whose edge after the US fee is at least the engine's min_edge.
 *  Works on Free's banded quote too: min_edge (2¢) is a band cut (lib/data/gate.ts EDGE), so the band's low end
 *  clears it exactly when the exact edge does. */
export const onUs = (m: Pick<Market, "us">, minEdge: number): boolean =>
  !!m.us && m.us.ask != null && m.us.edge != null && m.us.edge >= minEdge;

/** The filter only bites when the scan actually priced Polymarket US (meta.us.ok). A scan from before the US venue
 *  shipped, or one whose US fetch failed, has no `us` on any market: filtering would empty Best bets for everyone. */
export const usActive = (meta: Pick<ScanMeta, "us">, f: { view: string; us: boolean }): boolean =>
  f.view === "flags" && f.us && meta.us?.ok === true;

/** Return used to rank when the US filter is on: the US one (banded for Free), else the international one. */
export const usRoi = (m: Pick<Market, "us">, fallback: number): number => m.us?.roi_pct ?? fallback;
