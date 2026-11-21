"use client";
// #19 (Marc, Nov 20): every saved view in one list, on Best bets and All markets: apply, rename, delete.
// Loaded only when "Saved views" is tapped (components/presets/SavedViews.tsx), so the pages' first JS doesn't grow.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterState } from "@/lib/filters/state";
import { presetState, replacePatch } from "@/lib/presets";
import { getRepo, type Preset } from "@/lib/repo";
import { useCollection } from "@/lib/repo/hooks";

export default function SavedViewsDialog({ onApply, onClose }: { onApply: (patch: Partial<FilterState>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const rows = useCollection("presets");
  const views = useMemo(() => [...rows].sort((a, b) => a.position - b.position), [rows]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { ref.current?.showModal(); }, []);

  const apply = (p: Preset) => { onApply(replacePatch(presetState(p.query))); ref.current?.close(); };
  async function rename() {
    if (!editing?.name.trim()) return;
    try { await getRepo().presets.update(editing.id, { name: editing.name.trim() }); setEditing(null); setError(null); }
    catch { setError("Couldn’t rename. Try again."); }
  }
  async function remove(p: Preset) {
    if (confirm !== p.id) return setConfirm(p.id);
    try { await getRepo().presets.remove(p.id); setConfirm(null); setError(null); }
    catch { setError("Couldn’t delete. Try again."); }
  }

  const act = "min-h-11 rounded-input px-3 text-[13px] text-muted hover:text-text";
  return (
    <dialog
      ref={ref}
      aria-labelledby="saved-views-t"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      className="m-auto w-[min(92vw,460px)] rounded-card border border-border bg-surface p-0 text-text backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 id="saved-views-t" className="text-lg font-semibold">Saved views</h2>
        <button type="button" aria-label="Close saved views" onClick={() => ref.current?.close()} className="flex size-11 items-center justify-center rounded-input text-muted hover:text-text">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {views.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No saved views yet. Set the filters you like, then tap “+ Save this view”.</p>
      ) : (
        <ul className="flex max-h-[60dvh] flex-col overflow-y-auto py-2" data-testid="saved-views-list">
          {views.map((p) => (
            <li key={p.id} className="flex items-center gap-1 px-3">
              {editing?.id === p.id ? (
                <form className="flex flex-1 items-center gap-1 py-1" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                  <input aria-label="New name" autoFocus maxLength={60} value={editing.name} onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    className="min-h-11 flex-1 rounded-input border border-border bg-input px-3 text-sm text-text focus:border-accent focus:outline-none" />
                  <button type="submit" disabled={!editing.name.trim()} className="min-h-11 rounded-input px-3 text-[13px] font-semibold text-accent hover:text-accent-hover disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className={act}>Cancel</button>
                </form>
              ) : (
                <>
                  <button type="button" onClick={() => apply(p)} className="flex min-h-11 flex-1 items-center gap-2 truncate rounded-input px-2 text-left text-sm hover:bg-raised" aria-label={`Apply ${p.name}`}>
                    {p.emoji && <span aria-hidden="true">{p.emoji}</span>}
                    <span className="truncate">{p.name}</span>
                    {p.is_default && <span className="flex-none text-xs text-muted">· default</span>}
                  </button>
                  <button type="button" onClick={() => { setEditing({ id: p.id, name: p.name }); setConfirm(null); }} className={act} aria-label={`Rename ${p.name}`}>Rename</button>
                  <button type="button" onClick={() => remove(p)} className={`${act} ${confirm === p.id ? "text-negative hover:text-negative" : ""}`} aria-label={confirm === p.id ? `Confirm delete ${p.name}` : `Delete ${p.name}`}>
                    {confirm === p.id ? "Delete?" : "Delete"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="px-5 pb-4 text-sm text-warning">{error}</p>}
    </dialog>
  );
}
