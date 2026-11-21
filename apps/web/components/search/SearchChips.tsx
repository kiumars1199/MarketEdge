"use client";

// How the search was understood (docs/13 § Parsed chips): one removable chip per recognized piece of `?q=`,
// plus the honest note when nothing matched everything and the search was widened.
import type { MarketsResponse } from "@/lib/api";
import type { FilterState } from "@/lib/filters/state";
import { removeChip } from "@/lib/search/parse";

const X = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;

export function SearchChips({ q, search, onChange }: { q?: string; search?: MarketsResponse["search"]; onChange: (p: Partial<FilterState>) => void }) {
  if (!q) return null;
  const chips = search?.chips ?? [];
  const setQ = (next: string) => onChange({ q: next.trim() || undefined });
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Search understood as" className="flex flex-wrap items-center gap-2">
        <li className="text-[13px] text-muted">Searching</li>
        {chips.map((c) => (
          <li key={`${c.kind}:${c.raw}`}>
            <button
              type="button"
              onClick={() => setQ(removeChip(q, c))}
              aria-label={`Remove from search: ${c.label}`}
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-3 pr-2 text-[13px] text-soft hover:border-accent-border hover:text-text"
            >
              {c.label}
              {X}
            </button>
          </li>
        ))}
        {!chips.length && <li className="text-[13px] text-soft">“{q}”</li>}
        <li>
          <button type="button" onClick={() => setQ("")} className="min-h-9 px-2 text-[13px] text-muted hover:text-text">Clear search</button>
        </li>
      </ul>
      {search?.relaxed && (
        <p role="status" data-testid="relaxed" className="rounded-card border border-border bg-surface px-4 py-3 text-[13px] leading-relaxed text-soft">
          {search.relaxed}
        </p>
      )}
    </div>
  );
}
