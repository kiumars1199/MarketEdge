"use client";
// Quick filter chips (docs/04 § Quick filter chips): the user's favorite topics pinned first, then the standard
// chips, then "+ Save this view". Each chip toggles a FilterState patch. Screener pages render <QuickChips state onChange />.
import { useState } from "react";
import type { FilterState } from "@/lib/filters/state";
import { PresetQuotaError, savePresetFromState } from "@/lib/presets";
import { useProfile } from "@/lib/repo/hooks";
import { TAXONOMY } from "@/lib/taxonomy";
import { suggestViewName } from "@/lib/presets-name";
import { chipClass, SaveViewDialog } from "./SaveViewDialog";
import { SavedViews } from "./SavedViews";

type Patch = Partial<FilterState>;
interface Chip { key: string; label: string; on: (s: FilterState) => boolean; toggle: (s: FilterState) => Patch }

const toggleIn = <T,>(list: T[] | undefined, v: T): T[] | undefined => {
  const next = list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];
  return next.length ? next : undefined;
};
const flag = (key: string, label: string, field: keyof FilterState, value: unknown): Chip => ({
  key, label, on: (s) => s[field] === value, toggle: (s) => ({ [field]: s[field] === value ? undefined : value }),
});
const topicChip = (id: string, label?: string): Chip => ({
  key: `t:${id}`, label: label ?? TAXONOMY[id]?.label ?? id,
  on: (s) => !!s.topics?.includes(id), toggle: (s) => ({ topics: toggleIn(s.topics, id) }),
});

const STANDARD: Chip[] = [
  { key: "flags", label: "Best bets only", on: (s) => s.view === "flags", toggle: (s) => ({ view: s.view === "flags" ? "markets" : "flags" }) },
  flag("conf", "Confident", "edge_low_positive", true),
  flag("val", "Validated", "validated_only", true),
  flag("cw", "Closes < 24h", "closes_within_h", 24),
  flag("live", "Live", "live_only", true),
  topicChip("weather", "Weather"), topicChip("sports.nfl"), topicChip("sports.soccer"),
  { key: "c:crypto", label: "Crypto", on: (s) => !!s.categories?.includes("crypto"), toggle: (s) => ({ categories: toggleIn(s.categories, "crypto") }) },
  { key: "xc:sports", label: "Hide sports", on: (s) => !!s.exclude_categories?.includes("sports"), toggle: (s) => ({ exclude_categories: toggleIn(s.exclude_categories, "sports") }) },
];

export function QuickChips({ state, onChange }: { state: FilterState; onChange: (patch: Patch) => void }) {
  const { favorite_topics } = useProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const favs = favorite_topics.filter((id) => TAXONOMY[id]).map((id) => topicChip(id));
  const chips = [...favs, ...STANDARD.filter((c) => !favs.some((f) => f.key === c.key))];

  async function save(name: string, emoji: string | null) {
    try {
      await savePresetFromState(state, name, emoji);
      setSaving(false); setError(null); setNote(`Saved “${name}”`); setTimeout(() => setNote(null), 2500);
    } catch (e) {
      setError(e instanceof PresetQuotaError ? `You can keep ${e.limit} saved ${e.limit === 1 ? "view" : "views"} on your plan. Delete one or upgrade.` : "Couldn’t save. Try again.");
    }
  }

  return (
    <div role="group" aria-label="Quick filters" className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {chips.map((c, i) => {
        const on = c.on(state);
        return (
          <button key={c.key} type="button" aria-pressed={on} onClick={() => onChange({ ...c.toggle(state), page: 1 })}
            className={`${chipClass(on)} flex-none`}>
            {i < favs.length && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-label="Favorite topic" className="text-accent">
                <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
              </svg>
            )}
            {c.label}
          </button>
        );
      })}
      <button type="button" onClick={() => setSaving(true)} className={`${chipClass(false)} flex-none`}>+ Save this view</button>
      <SavedViews onApply={onChange} className={`${chipClass(false)} flex-none`} />
      <span role="status" className="flex-none text-[13px] text-accent-softer">{note}</span>
      <SaveViewDialog open={saving} title="Save this view" name={suggestViewName(state)} error={error} onSubmit={save} onClose={() => { setSaving(false); setError(null); }} />
    </div>
  );
}
