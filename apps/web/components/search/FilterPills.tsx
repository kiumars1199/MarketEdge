"use client";

// Simple filters (docs/13 §2, docs/18 §3): Topic · Pays · Chance · Return · Closes as dropdown pills, then Sort and
// "More filters" (the full panel, as a sheet). Each choice shows how many bets it leaves (facets = every filter
// but its own). Everything lives in the URL through `onChange`, like the rest of the screener.
import { LIVE_NOT_BY_BAND } from "@/lib/proof";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Facets, MetaResponse } from "@/lib/api";
import { CHANCE_BANDS, PAYS_BANDS, liftsFloor } from "@/lib/filters/apply";
import type { FilterState } from "@/lib/filters/state";
import { useProfile } from "@/lib/repo/hooks";
import { timeWindow } from "@/lib/search/parse";
import { TAXONOMY, TAXONOMY_TREE } from "@/lib/taxonomy";
import { FilterPanel } from "@/components/screener/FilterPanel";
import type { Mode } from "@/components/screener/useScreener";
import { exactCount, formatCount } from "@/lib/format";
import { useBacktest } from "@/components/market/TierNote";
import { paysFilterNote } from "@/lib/trackRecord";

type Change = (p: Partial<FilterState>) => void;
type Opt = { key: string; label: string; n?: number; patch: Partial<FilterState>; on: boolean };

const nf = formatCount;   // docs/18 §4
const H = 3_600_000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const CATEGORIES = new Set(TAXONOMY_TREE.map((n) => n.id));

const SIMPLE_SORTS: { label: string; sort: FilterState["sort"] }[] = [
  { label: "Best return", sort: { key: "roi", dir: "desc" } },
  { label: "Most likely", sort: { key: "win_prob", dir: "desc" } },
  { label: "Closing soon", sort: { key: "closes", dir: "asc" } },
  { label: "Biggest payout", sort: { key: "pays", dir: "desc" } },
];

/** Dropdown pill: the button names the filter (and its value when set); the panel is a popover on desktop, a bottom sheet on phones. */
function Pill({ name, value, wide, right, children }: { name: string; value?: string; wide?: boolean; right?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => (setOpen(false), btn.current?.focus());
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    root.current?.querySelector<HTMLElement>("[data-autofocus], [aria-pressed]")?.focus();
    return () => (document.removeEventListener("pointerdown", out), document.removeEventListener("keydown", esc));
  }, [open]);
  const on = value !== undefined;
  return (
    <div ref={root} className="relative">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] ${on ? "border-accent-border bg-accent-bg text-accent-softer" : "border-border bg-surface text-soft hover:border-accent-border hover:text-text"}`}
      >
        {on ? <><span className="text-muted">{name}:</span> {value}</> : name}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={open ? "rotate-180" : ""}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 md:hidden" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            id={id}
            role="dialog"
            aria-label={name}
            className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[75dvh] flex-col overflow-y-auto rounded-t-2xl border border-border bg-raised p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:absolute md:inset-x-auto md:bottom-auto ${right ? "md:right-0" : "md:left-0"} md:top-full md:mt-2 md:max-h-[420px] md:rounded-card md:pb-2 ${wide ? "md:w-80" : "md:w-64"}`}
          >
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted md:hidden">{name}</p>
            {children(close)}
          </div>
        </>
      )}
    </div>
  );
}

function Options({ opts, onChange, close }: { opts: Opt[]; onChange: Change; close: () => void }) {
  return (
    <ul className="flex flex-col">
      {opts.map((o) => (
        <li key={o.key}>
          <button
            type="button"
            aria-pressed={o.on}
            onClick={() => (onChange(o.patch), close())}
            className={`flex min-h-11 w-full items-center gap-2 rounded-input px-3 text-left text-sm md:min-h-10 ${o.on ? "bg-accent-bg text-accent-soft" : o.n === 0 ? "text-muted hover:bg-muted-bg" : "text-soft hover:bg-muted-bg hover:text-text"}`}
          >
            {o.label}
            {o.n !== undefined && <span className="ml-auto pl-3 text-xs tabular-nums text-muted" title={exactCount(o.n)}>{nf(o.n)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

const toggle = <T,>(list: T[] | undefined, x: T): T[] | undefined => {
  const next = list?.includes(x) ? list.filter((y) => y !== x) : [...(list ?? []), x];
  return next.length ? next : undefined;
};

/** Topic: searchable; my topics pinned; categories and sports leagues by size; several at once. */
function TopicPill({ s, facets, onChange }: { s: FilterState; facets?: Facets; onChange: Change }) {
  const [q, setQ] = useState("");
  const favs = useProfile().favorite_topics.filter((id) => TAXONOMY[id]);
  const isCat = (id: string) => CATEGORIES.has(id);
  const count = (id: string) => (isCat(id) ? facets?.categories[id] : facets?.topics[id]);
  const on = (id: string) => (isCat(id) ? !!s.categories?.includes(id as never) : !!s.topics?.includes(id));
  const flip = (id: string) => onChange(isCat(id) ? { categories: toggle(s.categories, id as never) } : { topics: toggle(s.topics, id) });
  const chosen = [...(s.categories ?? []), ...(s.topics ?? [])];
  const value = chosen.length === 0 ? undefined : chosen.length === 1 ? (TAXONOMY[chosen[0]!]?.label ?? chosen[0]) : `${chosen.length} topics`;

  const needle = q.trim().toLowerCase();
  const pool = needle
    ? Object.keys(TAXONOMY).filter((id) => id !== "other" && TAXONOMY[id]!.label.toLowerCase().includes(needle))
    : [
        ...TAXONOMY_TREE.map((n) => n.id).filter((id) => id !== "sports" && id !== "other"),
        ...(TAXONOMY_TREE.find((n) => n.id === "sports")?.children ?? []).map((n) => n.id),
      ];
  const list = [...new Set([...chosen, ...pool])]
    .filter((id) => !favs.includes(id) || needle)
    .filter((id) => on(id) || (count(id) ?? 0) > 0 || needle)
    .sort((a, b) => Number(on(b)) - Number(on(a)) || (count(b) ?? 0) - (count(a) ?? 0))
    .slice(0, needle ? 30 : 14);

  const row = (id: string) => (
    <li key={id}>
      <label className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-input px-3 text-sm md:min-h-10 ${on(id) ? "text-accent-soft" : count(id) === 0 ? "text-muted" : "text-soft"} hover:bg-muted-bg hover:text-text`}>
        <input type="checkbox" checked={on(id)} onChange={() => flip(id)} className="size-4 flex-none accent-[var(--accent)]" />
        {TAXONOMY[id]?.label ?? id}
        {count(id) !== undefined && <span className="ml-auto pl-3 text-xs tabular-nums text-muted" title={exactCount(count(id))}>{nf(count(id)!)}</span>}
      </label>
    </li>
  );

  return (
    <Pill name="Topic" value={value} wide>
      {(close) => (
        <>
          <input
            data-autofocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a topic"
            aria-label="Find a topic"
            className="mx-1 mb-1 min-h-11 rounded-[10px] border border-border bg-input px-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
          />
          {favs.length > 0 && !needle && (
            <>
              <p className="px-3 pt-1 text-xs text-muted">My topics</p>
              <ul className="flex flex-col border-b border-border pb-1">{favs.map(row)}</ul>
            </>
          )}
          <ul className="flex flex-col">{list.map(row)}</ul>
          {!list.length && <p className="px-3 py-2 text-sm text-muted">No topic called “{q}”.</p>}
          <div className="mt-1 flex justify-between border-t border-border px-1 pt-2">
            <button type="button" disabled={!chosen.length} onClick={() => onChange({ topics: undefined, categories: undefined })} className="min-h-11 px-2 text-[13px] text-muted hover:text-text disabled:opacity-40">Clear</button>
            <button type="button" onClick={close} className="min-h-11 rounded-input bg-accent px-4 text-[13px] font-semibold text-on-accent">Done</button>
          </div>
        </>
      )}
    </Pill>
  );
}

export function FilterPills({ state: s, mode, facets, meta, onChange, onReset, children }: {
  children?: ReactNode; state: FilterState; mode: Mode; facets?: Facets; meta?: MetaResponse | null; onChange: Change; onReset: () => void;
}) {
  // Pays (docs/18 §3)
  const paysOn = (lo: number, hi: number) => s.pays_min === lo && (s.pays_max ?? Infinity) === hi;
  const pays: Opt[] = [
    { key: "any", label: "Any", n: facets?.pays.any, on: s.pays_min === undefined && s.pays_max === undefined, patch: { pays_min: undefined, pays_max: undefined } },
    ...PAYS_BANDS.map(([k, label, lo, hi]) => ({ key: k, label, n: facets?.pays[k], on: paysOn(lo, hi), patch: { pays_min: lo, pays_max: hi === Infinity ? undefined : hi } })),
  ];
  // P5: each 2x+ band's tested return, under the choices (the user sees a long shot's record before picking it)
  const bt = useBacktest();
  const paysNote = paysFilterNote(bt?.chosen);
  const paysValue = pays.find((o) => o.on && o.key !== "any")?.label ?? (s.pays_min !== undefined || s.pays_max !== undefined ? "Custom" : undefined);

  // Chance: "Any" keeps the default 40% floor
  const chance: Opt[] = [
    { key: "any", label: "Any", n: facets?.chance.any, on: s.win_prob_min === undefined && s.win_prob_max === undefined, patch: { win_prob_min: undefined, win_prob_max: undefined } },
    ...CHANCE_BANDS.map(([k, label, lo, hi]) => ({
      key: k, label, n: facets?.chance[k],
      on: (s.win_prob_min ?? -1) === lo && (s.win_prob_max ?? 1) === hi,
      patch: { win_prob_min: lo, win_prob_max: hi === 1 ? undefined : hi },
    })),
  ];
  const chanceValue = chance.find((o) => o.on && o.key !== "any")?.label.replace(/ \(.*/, "") ?? (s.win_prob_min || s.win_prob_max !== undefined ? "Custom" : undefined);

  // Return
  const ret: Opt[] = [
    { key: "any", label: "Any", n: facets?.roi.any, on: s.roi_min === undefined, patch: { roi_min: undefined } },
    ...[5, 10, 20].map((v) => ({ key: String(v), label: `${v}%+`, n: facets?.roi[String(v)], on: s.roi_min === v, patch: { roi_min: v } })),
  ];
  const retValue = s.roi_min === undefined ? undefined : `${s.roi_min}%+`;

  // Closes: windows in the viewer's timezone, stored as hours from the scan (what the data measures from)
  const scan = meta?.meta.scanned_at ? meta.meta.scanned_at * 1000 : null;
  const win = (kind: string, hours = 0) => {
    if (!scan) return { after: undefined, within: kind === "hours" ? hours : 168 };
    const w = timeWindow(kind, Math.max(scan, Date.now()), Intl.DateTimeFormat().resolvedOptions().timeZone, hours);
    const after = (w.from - scan) / H;
    return { after: after > 0.05 ? r2(after) : undefined, within: r2((w.to - scan) / H) };
  };
  const between = (after: number | undefined, within: number) =>
    facets?.closes_h.reduce((sum, n, i) => (i >= Math.ceil(after ?? 0) && i <= Math.floor(within) ? sum + n : sum), 0);
  const closes: Opt[] = [
    { key: "any", label: "Any time", n: facets?.closes_h.reduce((a, b) => a + b, 0), on: s.closes_within_h === undefined && s.closes_after_h === undefined, patch: { closes_within_h: undefined, closes_after_h: undefined } },
    ...([["6h", "Next 6 hours", win("hours", 6)], ["today", "Today", win("today")], ["tomorrow", "Tomorrow", win("tomorrow")], ["week", "This week", win("week")]] as const).map(([k, label, w]) => ({
      key: k, label, n: between(w.after, w.within),
      on: s.closes_after_h === w.after && s.closes_within_h === w.within,
      patch: { closes_after_h: w.after, closes_within_h: w.within },
    })),
  ];
  const closesValue = closes.find((o) => o.on && o.key !== "any")?.label ?? (s.closes_within_h !== undefined || s.closes_after_h !== undefined ? "Custom" : undefined);

  const sorts: Opt[] = SIMPLE_SORTS.map((o) => ({ key: o.label, label: o.label, on: s.sort.key === o.sort.key && s.sort.dir === o.sort.dir, patch: { sort: o.sort } }));
  const sortLabel = sorts.find((o) => o.on)?.label ?? "Custom";
  const floorOn = s.win_prob_min === undefined && !liftsFloor(s);

  return (
    <div role="group" aria-label="Quick filters" className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&>*]:shrink-0">
      <TopicPill s={s} facets={facets} onChange={onChange} />
      <Pill name="Pays" value={paysValue}>{(close) => (
        <>
          <Options opts={pays} onChange={onChange} close={close} />
          {(paysNote || mode === "flags") && (
            <p data-testid="pays-note" className="mt-1 max-w-64 border-t border-border px-3 pt-2 text-xs leading-relaxed text-muted">
              {paysNote}{paysNote ? ` ${LIVE_NOT_BY_BAND}` : ""}{paysNote && mode === "flags" ? " " : ""}{mode === "flags" && "Choosing a payout includes lower-confidence bets."}{" "}
              <Link href="/track-record#pays" className="text-accent-hover underline-offset-2 hover:underline">See results</Link>
            </p>
          )}
        </>
      )}</Pill>
      <Pill name="Chance" value={chanceValue}>{(close) => <Options opts={chance} onChange={onChange} close={close} />}</Pill>
      <Pill name="Return" value={retValue}>{(close) => <Options opts={ret} onChange={onChange} close={close} />}</Pill>
      <Pill name="Closes" value={closesValue}>{(close) => <Options opts={closes} onChange={onChange} close={close} />}</Pill>
      <FilterPanel state={s} mode={mode} facets={facets} meta={meta} onChange={onChange} onReset={onReset} />
      {floorOn && (
        <button type="button" onClick={() => onChange({ win_prob_min: 0 })} title="Bets under a 40% chance are hidden by default" className="min-h-11 whitespace-nowrap px-2 text-[13px] text-muted hover:text-text">
          Hiding long shots · <span className="text-accent-hover">Show</span>
        </button>
      )}
      {children}
      <div className="md:ml-auto">
        <Pill name="Sort" value={sortLabel} right>{(close) => <Options opts={sorts} onChange={onChange} close={close} />}</Pill>
      </div>
    </div>
  );
}
