// #53 (Marc, Nov 20): the "Save this view" dialog starts with a name built from the filters that are on, so a view can
// be saved in one tap. Nothing on (the default view): "My view". Plain words only (lib/banned.ts), at most 60 characters.
import type { FilterState } from "@/lib/filters/state";
import { TAXONOMY } from "@/lib/taxonomy";

const CATEGORY: Record<string, string> = {
  sports: "Sports", crypto: "Crypto", politics: "Politics", finance: "Finance", culture: "Culture",
  weather: "Weather", tech: "Tech", geopolitics: "World", other: "Other",
};
const x = (n: number) => `${Number(n.toFixed(2))}x`;
const hours = (h: number) => (h < 48 ? `${h}h` : `${Math.round(h / 24)} days`);

export function suggestViewName(s: FilterState): string {
  const parts: string[] = [];
  if (s.q?.trim()) parts.push(`“${s.q.trim()}”`);
  const topics = (s.topics ?? []).map((id) => TAXONOMY[id]?.label).filter((l): l is string => !!l);
  if (topics.length) parts.push(topics.slice(0, 2).join(", ") + (topics.length > 2 ? ` +${topics.length - 2}` : ""));
  const cats = (s.categories ?? []).map((c) => CATEGORY[c] ?? c);
  if (cats.length) parts.push(cats.slice(0, 2).join(", ") + (cats.length > 2 ? ` +${cats.length - 2}` : ""));
  if (s.exclude_categories?.length) parts.push(`No ${s.exclude_categories.map((c) => (CATEGORY[c] ?? c).toLowerCase()).join(", ")}`);
  if (s.side === "favorite") parts.push("Favorites");
  if (s.side === "underdog") parts.push("Underdogs");
  if (s.pays_min !== undefined && s.pays_max !== undefined) parts.push(`Pays ${x(s.pays_min)}–${x(s.pays_max)}`);
  else if (s.pays_min !== undefined) parts.push(`Pays ${x(s.pays_min)}+`);
  else if (s.pays_max !== undefined) parts.push(`Pays under ${x(s.pays_max)}`);
  if (s.win_prob_min !== undefined && s.win_prob_min > 0) parts.push(`${Math.round(s.win_prob_min * 100)}%+ to win`);
  if (s.live_only) parts.push("Live");
  if (s.closes_within_h !== undefined) parts.push(`Closes in ${hours(s.closes_within_h)}`);
  if (s.edge_low_positive) parts.push("Confident");
  if (s.validated_only) parts.push("Tested");
  if (s.watchlisted_only) parts.push("My list");
  if (s.favorites_only) parts.push("My topics");
  const name = parts.slice(0, 3).join(" · ");
  if (!name) return "My view";
  return name.length <= 60 ? name : `${name.slice(0, 59).trimEnd()}…`;
}
