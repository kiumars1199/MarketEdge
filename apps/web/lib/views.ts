// Built-in views (docs/04 § Presets) as URL patches, plus lookup of a user's saved preset.
// Used by dashboards and alert rules. ponytail: Lane D1's preset bar may define the same list; lead can dedupe.
import { FilterState, type FilterInput } from "@/lib/filters/state";
import { parse, toQuery } from "@/lib/filters/url";
import type { Preset } from "@/lib/repo/types";

const BUILTIN_VIEWS = [
  { id: "builtin:best", name: "Best bets right now", qs: "view=flags&vd=worth it,thin&wp=0.4&s=roi.desc" },
  { id: "builtin:likely", name: "Most likely to win", qs: "view=flags&wp=0.8&s=win_prob.desc" },
  { id: "builtin:weather", name: "Weather tomorrow", qs: "t=weather&cw=36&conf=1" },
  { id: "builtin:nfl-fav", name: "NFL favorites, 1–3 days out", qs: "t=sports.nfl&side=favorite&ca=24&cw=96&e=0.02" },
  { id: "builtin:soccer", name: "Soccer pre-game", qs: "t=sports.soccer&cw=48&conf=1" },
  { id: "builtin:closing", name: "Closing in 6 hours", qs: "cw=6&conf=1" },
  { id: "builtin:capacity", name: "Big capacity", qs: "view=flags&cap=1000" },
  { id: "builtin:crypto", name: "Crypto daily", qs: "c=crypto&fq=daily" },
  { id: "builtin:all", name: "All markets", qs: "" },
] as const;

export interface View { id: string; name: string; state: FilterState }

export function viewById(id: string | null | undefined, presets: Preset[]): View | null {
  if (!id) return null;
  const b = BUILTIN_VIEWS.find((v) => v.id === id);
  if (b) return { id, name: b.name, state: parse(b.qs) };
  const p = presets.find((x) => x.id === id);
  if (!p) return null;
  const r = FilterState.safeParse(p.query ?? {});
  return r.success ? { id, name: p.name, state: r.data } : null;
}

export const allViews = (presets: Preset[]) => [
  ...BUILTIN_VIEWS.map((v) => ({ id: v.id, name: v.name })),
  ...presets.map((p) => ({ id: p.id, name: p.name })),
];

/** Link that opens a view in the screener ("/?…" or "/markets?…"). */
export function viewHref(state: FilterInput): string {
  const s = FilterState.parse(state);
  const { view, ...rest } = s;
  return `${view === "flags" ? "/" : "/markets"}${toQuery({ ...rest, view: "markets" } as FilterState)}`;
}
