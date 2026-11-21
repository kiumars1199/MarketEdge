"use client";
// Name + emoji dialog shared by PresetBar (save, save as new, rename) and QuickChips ("+ Save this view").
import { useEffect, useId, useRef, useState } from "react";

export const chipClass = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] leading-none ${
    active ? "border-accent-border bg-accent-bg text-accent-soft" : "border-border bg-input text-soft hover:border-accent-border hover:text-text"
  }`;

export function SaveViewDialog({ open, title, submitLabel = "Save", name = "", emoji = "", error, onSubmit, onClose }: {
  open: boolean; title: string; submitLabel?: string; name?: string; emoji?: string | null; error?: string | null;
  onSubmit: (name: string, emoji: string | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [n, setN] = useState(name);
  const [e, setE] = useState(emoji ?? "");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setN(name); setE(emoji ?? ""); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open, name, emoji]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${id}-t`}
      className="m-auto w-[min(92vw,400px)] rounded-card border border-border bg-surface p-0 text-text backdrop:bg-black/60"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-6"
        onSubmit={(ev) => { ev.preventDefault(); if (n.trim()) onSubmit(n.trim(), e.trim() || null); }}
      >
        <h2 id={`${id}-t`} className="text-lg font-semibold">{title}</h2>
        <div className="flex gap-3">
          <label className="flex w-20 flex-col gap-1.5 text-sm text-muted">
            Emoji
            <input value={e} onChange={(ev) => setE(ev.target.value)} maxLength={8} placeholder="—" aria-describedby={`${id}-e`}
              className="rounded-input border border-border bg-input px-3 py-2.5 text-center text-text placeholder:text-muted focus:border-accent focus:outline-none" />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            Name
            <input value={n} onChange={(ev) => setN(ev.target.value)} maxLength={60} required autoFocus placeholder="NFL edges"
              className="rounded-input border border-border bg-input px-3 py-2.5 text-text placeholder:text-muted focus:border-accent focus:outline-none" />
          </label>
        </div>
        <p id={`${id}-e`} className="sr-only">Optional</p>
        {error && <p role="alert" className="text-sm text-warning">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-input px-4 py-2.5 text-sm text-muted hover:text-text">Cancel</button>
          <button type="submit" disabled={!n.trim()} className="rounded-input bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
