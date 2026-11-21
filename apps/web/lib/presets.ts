// Presets (docs/04 § Presets, docs/05 F-07): built-ins as FilterState patches + saving the current view.
import { clientTier, quota, type Tier } from "@/lib/entitlements";
import { FilterState, defaultState, type FilterInput } from "@/lib/filters/state";
import { serialize } from "@/lib/filters/url";
import { getRepo, type Preset } from "@/lib/repo";
import { TAXONOMY } from "@/lib/taxonomy";
import { track } from "@/lib/telemetry";

export interface BuiltinPreset { id: string; name: string; patch: FilterInput }

/** Built-ins are read-only (duplicate to edit). Ids are stable so active/default detection survives reloads. */
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  { id: "builtin:best-bets", name: "Best bets right now",
    patch: { view: "flags", verdicts: ["worth it", "thin", "no sellers", "no book"], sort: { key: "roi", dir: "desc" } } },
  { id: "builtin:most-likely", name: "Most likely to win",
    patch: { view: "flags", win_prob_min: 0.8, sort: { key: "win_prob", dir: "desc" } } },
  { id: "builtin:weather-tomorrow", name: "Weather tomorrow",
    patch: { topics: ["weather"], closes_within_h: 36, edge_low_positive: true } },
  { id: "builtin:nfl-favorites", name: "NFL favorites, 1–3 days out",
    patch: { topics: ["sports.nfl"], side: "favorite", closes_after_h: 24, closes_within_h: 96, edge_min: 0.02 } },
  { id: "builtin:soccer-pregame", name: "Soccer pre-game",
    patch: { topics: ["sports.soccer"], closes_within_h: 48, edge_low_positive: true } },
  // education: long shots sit under the 40% default floor, so win_prob_min 0 turns it off
  { id: "builtin:longshots", name: "Cheap longshots to avoid",
    patch: { side: "underdog", price_max: 0.25, win_prob_min: 0, sort: { key: "edge", dir: "asc" } } },
  { id: "builtin:closing-6h", name: "Closing in 6 hours",
    patch: { closes_within_h: 6, edge_low_positive: true } },
  { id: "builtin:big-capacity", name: "Big capacity",
    patch: { view: "flags", capacity_min_usd: 1000 } },
  { id: "builtin:crypto-daily", name: "Crypto daily",
    patch: { categories: ["crypto"], frequency: ["daily"] } },
];
for (const p of BUILTIN_PRESETS) for (const t of p.patch.topics ?? []) console.assert(t in TAXONOMY, `preset ${p.id}: unknown topic ${t}`);

/** Full state a preset query stands for (replaces every filter, not a merge). Bad stored data falls back to default. */
export function presetState(query: unknown): FilterState {
  const r = FilterState.safeParse({ ...(query as object), page: 1 });
  return r.success ? r.data : defaultState();
}

/** Patch that replaces every field (unset ones explicitly undefined), so `{...state, ...patch}` can't keep stale filters. */
export const replacePatch = (s: FilterState): Partial<FilterState> =>
  ({ ...Object.fromEntries(Object.keys(FilterState.shape).map((k) => [k, undefined])), ...s });

/** Two states show the same view (page ignored). */
export const sameView = (a: FilterState, b: FilterState) =>
  serialize({ ...a, page: 1 }).toString() === serialize({ ...b, page: 1 }).toString();

/** What gets stored: the FilterState minus paging. */
export const toQuery = (state: FilterState) => ({ ...state, page: 1 });

/** Thrown when the tier's preset quota is used up. */
export class PresetQuotaError extends Error {
  constructor(readonly limit: number) { super(`Preset limit reached (${limit})`); }
}

const tier = (): Tier => clientTier();   // the server enforces the same quota on save

/** Save the current view as a user preset (C1 "Save as preset", PresetBar, "+ Save this view"). */
export async function savePresetFromState(state: FilterState, name?: string, emoji: string | null = null): Promise<Preset> {
  const repo = getRepo();
  const all = await repo.presets.list();
  const limit = quota(tier(), "presets");
  if (all.length >= limit) throw new PresetQuotaError(limit);
  const saved = await repo.presets.insert({
    name: name?.trim() || `My view ${all.length + 1}`, emoji,
    query: toQuery(state), columns: null, sort: state.sort,
    is_default: false, position: Math.max(-1, ...all.map((p) => p.position)) + 1,
  });
  track("preset_saved", { count: all.length + 1 }); // never the name or the filter values
  return saved;
}

/** Query key that carries a shared preset's name; not a FilterState key, so parse() ignores it. */
export const SHARE_KEY = "preset";

/** Link that reproduces a view; the receiver gets "Save to my presets". */
export function shareLink(state: FilterState, name: string, base: string): string {
  const p = serialize({ ...state, page: 1 });
  p.set(SHARE_KEY, name);
  return `${base}?${p}`;
}
