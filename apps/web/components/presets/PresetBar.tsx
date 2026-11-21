"use client";
// Preset bar (docs/05 F-07): built-ins then the user's presets as chips; dirty state, save dialog, rename,
// duplicate, delete, set default, drag to reorder, share link. Screener pages render <PresetBar state onChange />.
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultState, type FilterState } from "@/lib/filters/state";
import { parse } from "@/lib/filters/url";
import { BUILTIN_PRESETS, PresetQuotaError, SHARE_KEY, presetState, replacePatch, sameView, savePresetFromState, shareLink, toQuery } from "@/lib/presets";
import { getRepo, type Preset } from "@/lib/repo";
import { useCollection } from "@/lib/repo/hooks";
import { suggestViewName } from "@/lib/presets-name";
import { chipClass, SaveViewDialog } from "./SaveViewDialog";

type Item = { id: string; name: string; emoji: string | null; state: FilterState; user?: Preset };
type Dialog = { mode: "save" | "rename" | "shared"; name?: string; emoji?: string | null; state?: FilterState } | null;
const ACTIVE_KEY = "me:active-preset";

const session = {
  get: () => { try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; } },
  set: (id: string) => { try { sessionStorage.setItem(ACTIVE_KEY, id); } catch { /* storage off */ } },
};

export function PresetBar({ state, onChange }: { state: FilterState; onChange: (patch: Partial<FilterState>) => void }) {
  const rows = useCollection("presets");
  const user = useMemo(() => [...rows].sort((a, b) => a.position - b.position), [rows]);
  const items: Item[] = useMemo(() => [
    ...BUILTIN_PRESETS.map((b) => ({ id: b.id, name: b.name, emoji: null, state: presetState(b.patch) })),
    ...user.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, state: presetState(p.query), user: p })),
  ], [user]);

  const [activeId, setActiveId] = useState<string | null>(null);
  // menu renders fixed at the ⋯ button so the chip row's horizontal scroll can't clip it
  const [menu, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const setMenu = (open: boolean) => setMenuPos(open ? menu : null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const booted = useRef(false);
  const defaultTried = useRef(false);

  // exact match wins; otherwise the last applied preset shows as modified
  const exact = items.find((i) => sameView(i.state, state));
  const active = exact ?? items.find((i) => i.id === activeId);
  const dirty = !exact && !!active;

  // mount: remember the active preset; a shared link offers "Save to my presets"
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    setActiveId(session.get());
    const url = new URL(window.location.href);
    const shared = url.searchParams.get(SHARE_KEY);
    if (!shared) return;
    defaultTried.current = true; // a shared link wins over the default preset
    setDialog({ mode: "shared", name: shared, state: parse(url.searchParams) });
    url.searchParams.delete(SHARE_KEY);
    history.replaceState(history.state, "", url);
  }, []);

  // the user's default preset opens on a pristine view only (never over a deep link)
  useEffect(() => {
    const def = user.find((p) => p.is_default);
    if (!def || defaultTried.current) return;
    defaultTried.current = true;
    if (sameView(state, defaultState())) apply({ id: def.id, name: def.name, emoji: def.emoji, state: presetState(def.query) });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) { setMenuPos(null); setConfirmDelete(false); }
    };
    const hide = () => setMenuPos(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", hide);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", hide); window.removeEventListener("resize", hide);
    };
  }, [menu]);

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(null), 2500); };
  function apply(i: Item) { setActiveId(i.id); session.set(i.id); setMenu(false); onChange(replacePatch(i.state)); }

  async function saveNew(name: string, emoji: string | null, from = state) {
    try {
      const p = await savePresetFromState(from, name, emoji);
      setActiveId(p.id); session.set(p.id); setDialog(null); setError(null); flash(`Saved “${p.name}”`);
    } catch (e) {
      setError(e instanceof PresetQuotaError ? `You can keep ${e.limit} saved ${e.limit === 1 ? "view" : "views"} on your plan. Delete one or upgrade.` : "Couldn’t save. Try again.");
    }
  }

  async function onSubmit(name: string, emoji: string | null) {
    if (dialog?.mode === "rename" && active?.user) {
      await getRepo().presets.update(active.user.id, { name, emoji });
      setDialog(null);
    } else await saveNew(name, emoji, dialog?.state ?? state);
  }

  const saveChanges = async () => {
    if (active?.user) { await getRepo().presets.update(active.user.id, { query: toQuery(state), sort: state.sort }); flash("Saved"); }
    else setDialog({ mode: "save", name: active ? `${active.name} (my copy)` : suggestViewName(state) });   // #53
  };

  async function setDefault(p: Preset) {
    const repo = getRepo();
    for (const o of user) if (o.is_default && o.id !== p.id) await repo.presets.update(o.id, { is_default: false });
    await repo.presets.update(p.id, { is_default: !p.is_default });
    setMenu(false);
  }

  async function share(i: Item) {
    const link = shareLink(i.state, i.name, `${location.origin}${location.pathname}`);
    setMenu(false);
    try { await navigator.clipboard.writeText(link); flash("Link copied"); } catch { window.prompt("Copy this link", link); }
  }

  async function remove(p: Preset) {
    if (!confirmDelete) return setConfirmDelete(true);
    await getRepo().presets.remove(p.id);
    setMenu(false); setConfirmDelete(false); flash(`Deleted “${p.name}”`);
  }

  async function drop(targetId: string) {
    if (!drag || drag === targetId) return;
    const ids = user.map((p) => p.id).filter((id) => id !== drag);
    ids.splice(ids.indexOf(targetId), 0, drag);
    const repo = getRepo();
    await Promise.all(ids.map((id, position) => repo.presets.update(id, { position })));
    setDrag(null);
  }

  const menuItem = "block w-full rounded-input px-3 py-2 text-left text-sm text-soft hover:bg-raised hover:text-text";

  return (
    <div className="flex flex-col gap-2">
      <div role="toolbar" aria-label="Saved views" className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        <span aria-hidden="true" className="flex-none pr-1 text-[13px] text-muted">Views</span>
        {items.map((i) => {
          const on = active?.id === i.id;
          return (
            <div
              key={i.id}
              className={`relative flex flex-none items-center ${drag === i.id ? "opacity-50" : ""}`}
              draggable={!!i.user}
              onDragStart={i.user ? () => setDrag(i.id) : undefined}
              onDragOver={i.user && drag ? (e) => e.preventDefault() : undefined}
              onDrop={i.user ? () => drop(i.id) : undefined}
              onDragEnd={() => setDrag(null)}
            >
              <button type="button" aria-pressed={on} onClick={() => apply(i)} className={`${chipClass(on)} ${on ? "rounded-r-none border-r-0 pr-2.5" : ""}`}>
                {i.emoji && <span aria-hidden="true">{i.emoji}</span>}
                {i.name}
                {i.user?.is_default && <span className="text-xs text-muted">· default</span>}
                {on && dirty && <span className="text-warning">· modified</span>}
              </button>
              {on && (
                <button type="button" aria-label={`More actions for ${i.name}`} aria-expanded={!!menu} aria-haspopup="menu"
                  onPointerDown={(e) => menu && e.stopPropagation()}
                  onClick={(e) => {
                    const r = e.currentTarget.parentElement!.getBoundingClientRect();
                    setMenuPos(menu ? null : { left: Math.max(16, Math.min(r.left, window.innerWidth - 224)), top: r.bottom + 8 });
                    setConfirmDelete(false);
                  }}
                  className="flex min-h-11 items-center rounded-r-full border border-l-0 border-accent-border bg-accent-bg pl-1.5 pr-3 text-accent-soft hover:text-text">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                </button>
              )}
            </div>
          );
        })}
        {dirty && (
          <span className="flex flex-none items-center gap-1 text-[13px]">
            <button type="button" onClick={saveChanges} className="rounded-input px-2 py-2 font-medium text-accent hover:text-accent-hover" aria-label={`Save changes to ${active?.name ?? "view"}`}>Save</button>
            <span className="text-muted" aria-hidden="true">·</span>
            <button type="button" onClick={() => active && apply(active)} className="rounded-input px-2 py-2 text-muted hover:text-text">Revert</button>
          </span>
        )}
        <span role="status" className="flex-none text-[13px] text-accent-softer">{note}</span>
      </div>

      {menu && active && (
        <div ref={menuRef} role="menu" style={menu} className="fixed z-40 w-52 rounded-card border border-border bg-surface p-1.5 shadow-lg shadow-black/40">
          {active.user && <button role="menuitem" className={menuItem} onClick={() => { setMenu(false); setDialog({ mode: "rename", name: active.name, emoji: active.emoji }); }}>Rename</button>}
          <button role="menuitem" className={menuItem} onClick={() => { setMenu(false); setDialog({ mode: "save", name: `${active.name} (copy)`, emoji: active.emoji, state: active.state }); }}>Duplicate</button>
          {active.user && <button role="menuitem" className={menuItem} onClick={() => setDefault(active.user!)}>{active.user.is_default ? "Stop opening by default" : "Open by default"}</button>}
          <button role="menuitem" className={menuItem} onClick={() => share(active)}>Copy share link</button>
          {active.user && (
            <button role="menuitem" className={`${menuItem} ${confirmDelete ? "bg-raised text-negative hover:text-negative" : ""}`} onClick={() => remove(active.user!)}>
              {confirmDelete ? "Click again to delete" : "Delete"}
            </button>
          )}
        </div>
      )}

      <SaveViewDialog
        open={!!dialog}
        title={dialog?.mode === "rename" ? "Rename view" : dialog?.mode === "shared" ? "Save shared view to my presets" : "Save this view"}
        submitLabel={dialog?.mode === "rename" ? "Rename" : dialog?.mode === "shared" ? "Save to my presets" : "Save"}
        name={dialog?.name}
        emoji={dialog?.emoji}
        error={error}
        onSubmit={onSubmit}
        onClose={() => { setDialog(null); setError(null); }}
      />
    </div>
  );
}
