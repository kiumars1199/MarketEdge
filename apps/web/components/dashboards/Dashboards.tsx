"use client";
// Dashboards (T-36, docs/05 F-10). Layout = CSS grid, 12 columns × 90px rows, with move/resize buttons
// (no react-grid-layout). Panel order + w/h persist in the dashboard's layout; x/y store the order.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Dialog, PageTitle, btn, btnDanger, btnGhost, btnPrimary, card, input } from "@/components/kit";
import { PANEL_KINDS, PanelBody, fullViewHref, needsView, panelTitle, segName, type PanelKind } from "@/components/dashboards/panels";
import { FEE_RATE } from "@/lib/execution";
import { getRepo } from "@/lib/repo";
import { useCollection } from "@/lib/repo/hooks";
import type { Dashboard, DashboardPanel } from "@/lib/repo/types";
import { allViews } from "@/lib/views";

const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);
const DEFAULT_SIZE: Record<PanelKind, [number, number]> = {
  preset_table: [6, 5], kpi: [6, 2], watchlist: [4, 4], calibration_chart: [6, 4], journal_summary: [6, 2], alerts_inbox: [4, 4],
};
const panel = (kind: PanelKind, extra: Partial<DashboardPanel> = {}): DashboardPanel => ({
  panel_id: crypto.randomUUID(), kind, x: 0, y: 0, w: DEFAULT_SIZE[kind][0], h: DEFAULT_SIZE[kind][1], ...extra,
});
const reindex = (l: DashboardPanel[]) => l.map((p, i) => ({ ...p, x: 0, y: i }));

const STARTER = () => reindex([
  panel("kpi", { preset_id: "builtin:best", w: 12, h: 2 }),
  panel("preset_table", { preset_id: "builtin:best", w: 7, h: 5 }),
  panel("calibration_chart", { query: { segment: "all", h: 24 }, w: 5, h: 5 }),
]);

async function createDashboard(name: string, layout = STARTER()) {
  const all = await getRepo().dashboards.list();
  return getRepo().dashboards.insert({ name, layout, position: all.length });
}

export function DashboardList() {
  const router = useRouter();
  const mounted = useMounted();
  const boards = useCollection("dashboards");
  const presets = useCollection("presets");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const d = await createDashboard(boards.length ? `Dashboard ${boards.length + 1}` : "My dashboard");
    router.push(`/dashboards/${d.id}`);
  };
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageTitle title="Dashboards" sub="Your views side by side. Each panel refreshes on its own and opens its full view.">
        <button type="button" className={btnPrimary} onClick={create} disabled={busy}>New dashboard</button>
      </PageTitle>
      {!mounted ? null : !boards.length ? (
        <div className={`${card} flex flex-col items-start gap-3 p-6`}>
          <h2 className="text-lg font-semibold">No dashboards yet</h2>
          <p className="max-w-xl text-sm text-muted">A new dashboard starts with three panels: key numbers for Best bets, the top Best bets, and how often bets won at each price. Add, move and resize panels after.</p>
          <button type="button" className={btnPrimary} onClick={create} disabled={busy}>Create my first dashboard</button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...boards].sort((a, b) => a.position - b.position).map((d) => (
            <li key={d.id}>
              <Link href={`/dashboards/${d.id}`} className={`${card} flex flex-col gap-2 p-5 hover:border-accent-border`}>
                <span className="text-lg font-semibold">{d.name}</span>
                <span className="text-sm text-muted">{d.layout.length} panel{d.layout.length === 1 ? "" : "s"}</span>
                <span className="line-clamp-2 text-xs text-muted">{d.layout.map((p) => panelTitle(p, presets)).join(" · ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DashboardView({ id }: { id: string }) {
  const mounted = useMounted();
  const router = useRouter();
  const boards = useCollection("dashboards");
  const presets = useCollection("presets");
  const d = boards.find((b) => b.id === id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);

  if (!mounted) return null;
  if (!d) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <h1 className="text-3xl font-bold">Dashboard not found</h1>
        <p className="mt-3 text-muted">It may have been deleted, or it lives in another browser.</p>
        <Link href="/dashboards" className={`${btn} mt-5`}>All dashboards</Link>
      </div>
    );
  }
  const save = (layout: DashboardPanel[]) => void getRepo().dashboards.update(d.id, { layout: reindex(layout) });
  const move = (i: number, by: number) => {
    const l = [...d.layout];
    const j = i + by;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j]!, l[i]!];
    save(l);
  };
  const resize = (i: number, dw: number, dh: number) =>
    save(d.layout.map((p, j) => (j === i ? { ...p, w: Math.min(12, Math.max(3, p.w + dw)), h: Math.min(10, Math.max(2, p.h + dh)) } : p)));
  const remove = async () => {
    if (!confirm(`Delete the dashboard “${d.name}”? Its panels go too.`)) return;
    await getRepo().dashboards.remove(d.id);
    router.push("/dashboards");
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboards" className="text-sm text-muted hover:text-text">Dashboards</Link>
          <h1 className="mt-1 text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">{d.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => setAdding(true)}>Add panel</button>
          <button type="button" className={btn} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Edit layout"}</button>
          <button type="button" className={btnGhost} onClick={() => setRenaming(true)}>Rename</button>
          <button type="button" className={btnDanger} onClick={remove}>Delete</button>
        </div>
      </div>
      {editing && <p className="text-sm text-muted">Use the arrows on each panel to move it, and the width and height buttons to resize. Changes save right away.</p>}
      {!d.layout.length ? (
        <div className={`${card} flex flex-col items-start gap-3 p-6`}>
          <p className="text-sm text-muted">This dashboard is empty.</p>
          <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>Add a panel</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:auto-rows-[90px] md:grid-cols-12 md:[grid-auto-flow:dense]">
          {d.layout.map((p, i) => (
            <section
              key={p.panel_id} aria-label={panelTitle(p, presets)}
              style={{ "--w": p.w, "--h": p.h } as React.CSSProperties}
              className={`${card} flex min-w-0 flex-col gap-2 overflow-hidden p-4 md:[grid-column:span_var(--w)] md:[grid-row:span_var(--h)] ${editing ? "border-accent-border" : ""}`}
            >
              <header className="flex items-center justify-between gap-2">
                <h2 className="truncate font-sans text-[15px] font-semibold">{panelTitle(p, presets)}</h2>
                {editing ? (
                  <PanelControls
                    i={i} n={d.layout.length} p={p} onMove={move} onResize={resize}
                    onRemove={() => save(d.layout.filter((_, j) => j !== i))}
                  />
                ) : (
                  <Link href={fullViewHref(p, presets)} className="flex-none text-xs text-accent-hover hover:underline">Open full view</Link>
                )}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <PanelBody panel={p} />
              </div>
            </section>
          ))}
        </div>
      )}
      <AddPanel open={adding} onClose={() => setAdding(false)} onAdd={(np) => { save([...d.layout, np]); setAdding(false); }} />
      <Rename open={renaming} board={d} onClose={() => setRenaming(false)} />
    </div>
  );
}

const ctl = "flex size-8 items-center justify-center rounded-md text-muted hover:bg-muted-bg hover:text-text disabled:opacity-30";
const Arrow = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d={d} /></svg>
);

function PanelControls({ i, n, p, onMove, onResize, onRemove }: {
  i: number; n: number; p: DashboardPanel; onMove: (i: number, by: number) => void; onResize: (i: number, dw: number, dh: number) => void; onRemove: () => void;
}) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-0.5" role="group" aria-label="Panel layout">
      <button type="button" className={ctl} aria-label="Move earlier" disabled={i === 0} onClick={() => onMove(i, -1)}><Arrow d="M15 18l-6-6 6-6" /></button>
      <button type="button" className={ctl} aria-label="Move later" disabled={i === n - 1} onClick={() => onMove(i, 1)}><Arrow d="M9 18l6-6-6-6" /></button>
      <span className="mx-1 hidden text-xs text-muted md:inline">W</span>
      <button type="button" className={`${ctl} hidden md:flex`} aria-label="Narrower" disabled={p.w <= 3} onClick={() => onResize(i, -1, 0)}><Arrow d="M5 12h14" /></button>
      <button type="button" className={`${ctl} hidden md:flex`} aria-label="Wider" disabled={p.w >= 12} onClick={() => onResize(i, 1, 0)}><Arrow d="M12 5v14M5 12h14" /></button>
      <span className="mx-1 hidden text-xs text-muted md:inline">H</span>
      <button type="button" className={`${ctl} hidden md:flex`} aria-label="Shorter" disabled={p.h <= 2} onClick={() => onResize(i, 0, -1)}><Arrow d="M5 12h14" /></button>
      <button type="button" className={`${ctl} hidden md:flex`} aria-label="Taller" disabled={p.h >= 10} onClick={() => onResize(i, 0, 1)}><Arrow d="M12 5v14M5 12h14" /></button>
      <button type="button" className={`${ctl} ml-1 text-negative`} aria-label="Remove panel" onClick={onRemove}><Arrow d="M6 6l12 12M18 6L6 18" /></button>
    </div>
  );
}

const SEGMENTS = ["all", ...Object.keys(FEE_RATE).map((c) => `cat:${c}`)];

function AddPanel({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (p: DashboardPanel) => void }) {
  const presets = useCollection("presets");
  const [kind, setKind] = useState<PanelKind>("preset_table");
  const [view, setView] = useState("builtin:best");
  const [segment, setSegment] = useState("all");
  const [h, setH] = useState(24);
  const add = () => onAdd(panel(kind, needsView(kind) ? { preset_id: view } : kind === "calibration_chart" ? { query: { segment, h } } : {}));
  return (
    <Dialog open={open} onClose={onClose} title="Add a panel">
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        Panel
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as PanelKind)}>
          {(Object.keys(PANEL_KINDS) as PanelKind[]).map((k) => <option key={k} value={k}>{PANEL_KINDS[k]}</option>)}
        </select>
      </label>
      {needsView(kind) && (
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          View
          <select className={input} value={view} onChange={(e) => setView(e.target.value)}>
            {allViews(presets).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}
      {kind === "calibration_chart" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Topic
            <select className={input} value={segment} onChange={(e) => setSegment(e.target.value)}>
              {SEGMENTS.map((s) => <option key={s} value={s}>{segName(s)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Time before close
            <select className={input} value={h} onChange={(e) => setH(Number(e.target.value))}>
              {[1, 6, 24, 72, 168].map((x) => <option key={x} value={x}>{x < 24 ? `~${x} h` : `~${x / 24} day${x > 24 ? "s" : ""}`}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={add}>Add panel</button>
      </div>
    </Dialog>
  );
}

function Rename({ open, board, onClose }: { open: boolean; board: Dashboard; onClose: () => void }) {
  const [name, setName] = useState(board.name);
  const save = () => { if (name.trim()) void getRepo().dashboards.update(board.id, { name: name.trim().slice(0, 60) }); onClose(); };
  return (
    <Dialog open={open} onClose={onClose} title="Rename dashboard">
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Name
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={!name.trim()}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}
