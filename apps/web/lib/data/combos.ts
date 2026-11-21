// Suggested combos (docs/18 §5.2): the same for everyone. Tier-"best" bets on different events (by event id) that
// close within a day of the request, never one whose title names a day that is already over (Marc #42/#52); the top 5
// two-leg and three-leg combos by return whose cautious chance Q_low still beats the price.
// A leg count whose combo backtest lost money (or was never tested) is left out.
import { closesWithinDay, combo, legOf, pastDated, type Combo, type ComboPays, type Leg } from "@/lib/combos";
export { COMBO_PAYS, type ComboPays } from "@/lib/combos";
import { band } from "@/lib/data/gate";
import { can, type Tier } from "@/lib/entitlements";
import type { ComboBacktestRecord } from "@/lib/types";
import { nowFor } from "@/lib/filters/apply";
import type { Store } from "./store";

export interface SuggestedCombo extends Combo { items: Leg[]; ret_range?: [number | null, number | null] }
export interface ComboGroup { size: 2 | 3; record: ComboBacktestRecord; combos: SuggestedCombo[] }
export interface CombosResponse { groups: ComboGroup[] }

const POOL = 40;   // ponytail: top 40 legs by return → ≤ 9,880 triples; widen if suggestions look samey
const TOP = 5;
const cache = new WeakMap<Store, ComboGroup[]>();
const allCache = new WeakMap<Store, ComboGroup[]>();
const BROWSE_TOP = 20;

function* choose<T>(xs: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) return yield acc;
  for (let i = start; i < xs.length; i++) yield* choose(xs, k, i + 1, [...acc, xs[i]!]);
}

/** Every leg still closes within a day of `now` and names no day that is over. Re-checked per request: the cached
 *  combos live as long as the store, and the clock moves on. */
const legOk = (l: Pick<Leg, "question" | "event">, closesAt: number, now: number) =>
  closesWithinDay(closesAt, now) && !pastDated(`${l.question} ${l.event}`, now, closesAt);
const open = (store: Store, groups: ComboGroup[], now: number) =>
  groups.map((g) => ({ ...g, combos: g.combos.filter((c) => c.items.every((l) => legOk(l, store.byId.get(l.market_id)?.closes_at ?? 0, now))) })).filter((g) => g.combos.length);

/** Every combo with an edge, by leg count (best return first), for leg counts whose combo backtest made money. */
function allCombos(store: Store): ComboGroup[] {
  const hit = allCache.get(store);
  if (hit) return hit;
  const now = nowFor(store);
  // one leg per event (its best-return side), so every combo is across different events
  const perEvent = new Map<string, Leg & { roi: number }>();
  for (const m of store.flags) {
    const v = m.execution?.verdict;
    if ((m.tier ?? "best") !== "best" || (v !== "worth it" && v !== "thin") || !legOk(m, m.closes_at, now)) continue;
    const s = m.best;
    const cur = perEvent.get(m.event_id);
    if (!cur || s.roi_pct > cur.roi) perEvent.set(m.event_id, { ...legOf(m, s), roi: s.roi_pct });
  }
  const pool = [...perEvent.values()].sort((a, b) => b.roi - a.roi).slice(0, POOL).map(({ roi: _roi, ...l }) => l as Leg);

  const groups: ComboGroup[] = [];
  for (const size of [2, 3] as const) {
    const record = store.backtest.combos?.[String(size)];
    if (!record || !(record.combos > 0) || !((record.roi_pct ?? 0) > 0)) continue;   // lost money in testing → hidden
    const found: SuggestedCombo[] = [];
    for (const items of choose(pool, size)) {
      const c = combo(items);
      if (c.has_edge) found.push({ ...c, items });
    }
    found.sort((a, b) => b.ret - a.ret);
    if (found.length) groups.push({ size, record, combos: found });
  }
  allCache.set(store, groups);
  return groups;
}

export function suggestCombos(store: Store): ComboGroup[] {
  const now = nowFor(store);
  // a leg that closed (or left the day) since the cache was built takes its combos with it; allCombos may have been
  // built for an earlier request, so the check runs on a fresh build too
  let groups = cache.get(store);
  if (!groups) cache.set(store, (groups = allCombos(store).map((g) => ({ ...g, combos: g.combos.slice(0, TOP) }))));
  return open(store, groups, now);
}

/** Combos page: the top combos per leg count that pay at least `minPays` (same legs and rules as the Best bets row). */
export function browseCombos(store: Store, minPays: ComboPays): ComboGroup[] {
  return open(store, allCombos(store).map((g) => ({ ...g, combos: g.combos.filter((c) => c.pays >= minPays) })), nowFor(store))
    .map((g) => ({ ...g, combos: varied(g.combos) }));
}

/** Best return first, but no leg in more than LEG_REPEAT combos, so one strong leg doesn't fill the page. */
const LEG_REPEAT = 3;
function varied(combos: SuggestedCombo[]): SuggestedCombo[] {
  const used = new Map<string, number>();
  const out: SuggestedCombo[] = [];
  for (const c of combos) {
    if (out.length >= BROWSE_TOP) break;
    if (c.items.some((l) => (used.get(l.market_id) ?? 0) >= LEG_REPEAT)) continue;
    for (const l of c.items) used.set(l.market_id, (used.get(l.market_id) ?? 0) + 1);
    out.push(c);
  }
  return out;
}

/** Free tier: no exact return or win chance (docs/15 § Paywall): return as a band, chances floored to 5%. */
const floor5 = (p: number) => Math.floor(p * 20) / 20;
export function gateCombos(groups: ComboGroup[], tier: Tier): CombosResponse {
  if (can(tier, "exact_edge")) return { groups };
  return {
    groups: groups.map((g) => ({
      ...g,
      combos: g.combos.map((c) => {
        const ret_range = band(c.ret * 100, [0, 5, 10, 20, 50]);
        return {
          ...c, ret: (ret_range[0] ?? 0) / 100, ret_range, q: floor5(c.q), q_low: floor5(c.q_low),
          items: c.items.map((l) => ({ ...l, q: floor5(l.q), q_low: floor5(l.q_low) })),
        };
      }),
    })),
  };
}
