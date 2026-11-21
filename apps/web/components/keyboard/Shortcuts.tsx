"use client";
// Global keyboard shortcuts + help dialog (docs/05 F-27). Mounted once in app/layout.tsx.
// Contract for pages: result cards/rows carry `data-row`; inside a row, the save star has `data-watch`
// and the "Alert me" control has `data-alert`; the open target is the row's first link (or the row itself).
// `f` dispatches a window CustomEvent "me:toggle-filters". "/" is handled by the header SearchCombobox.
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const HELP: [keys: string[], what: string][] = [
  [["/"], "Search"],
  [["Ctrl+K"], "Search (⌘K on a Mac)"],
  [["j"], "Next result"],
  [["k"], "Previous result"],
  [["Enter"], "Open the focused result"],
  [["w"], "Save the focused result to My list"],
  [["a"], "Alert me on the focused result"],
  [["f"], "Show or hide filters"],
  [["g", "f"], "Go to Best bets"],
  [["g", "w"], "Go to My list"],
  [["?"], "Show these shortcuts"],
];

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")].filter((r) => r.offsetParent !== null);
const currentRow = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-row]") ?? null;

function move(dir: 1 | -1) {
  const all = rows();
  if (!all.length) return;
  const cur = currentRow();
  const i = cur ? all.indexOf(cur) : -1;
  const next = all[Math.min(all.length - 1, Math.max(0, i < 0 ? 0 : i + dir))];
  if (!next.hasAttribute("tabindex") && !next.matches("a,button")) next.tabIndex = -1;
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

export function Shortcuts() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingG = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      if (dialog.current?.open && e.key !== "?") return;
      const k = e.key;
      if (Date.now() - pendingG.current < 1000) {
        pendingG.current = 0;
        if (k === "f") { e.preventDefault(); return router.push("/"); }
        if (k === "w") { e.preventDefault(); return router.push("/watchlist"); }
      }
      const row = currentRow();
      switch (k) {
        case "g": pendingG.current = Date.now(); return;
        case "j": e.preventDefault(); return move(1);
        case "k": e.preventDefault(); return move(-1);
        case "Enter":
          if (row && document.activeElement === row) { e.preventDefault(); (row.querySelector<HTMLElement>("a[href]") ?? row).click(); }
          return;
        case "w": row?.querySelector<HTMLElement>("[data-watch]")?.click(); return;
        case "a": row?.querySelector<HTMLElement>("[data-alert]")?.click(); return;
        case "f": window.dispatchEvent(new CustomEvent("me:toggle-filters")); return;
        case "?": {
          e.preventDefault();
          const d = dialog.current;
          if (d?.open) d.close(); else d?.showModal();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <dialog ref={dialog} aria-labelledby="kbd-title" className="m-auto w-[min(92vw,420px)] rounded-card border border-border bg-surface p-0 text-text backdrop:bg-black/60"
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h2 id="kbd-title" className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="flex size-9 items-center justify-center rounded-input text-muted hover:bg-raised hover:text-text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <dl className="flex flex-col divide-y divide-border text-sm">
          {HELP.map(([keys, what]) => (
            <div key={what} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-soft">{what}</dt>
              <dd className="flex flex-none items-center gap-1 text-muted">
                {keys.map((key, i) => (
                  <span key={key} className="flex items-center gap-1">
                    {i > 0 && <span className="text-xs">then</span>}
                    <kbd className="min-w-7 rounded-md border border-border bg-raised px-1.5 py-0.5 text-center font-sans text-xs text-text">{key}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  );
}
