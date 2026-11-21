"use client";

// FilterPanel (F-03): every FilterState field, sections in the F-03 order, in a "More filters" sheet
// (native <dialog>: right side on desktop, bottom on mobile; docs/13 §2: no permanent sidebar). Counts come from the API facets (current filter minus that facet).
// T-302: the body renders only while the sheet is open (its words were in the page's HTML, unseen, before), labels
// are plain (no "spread", lib/banned.ts), every control is at least 44px tall, and on Best bets the sheet also holds
// Sort and "On Polymarket US" (the chip row on the page keeps only the everyday choices).
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Facets, MetaResponse } from "@/lib/api";
import { FrequencyEnum, PeriodEnum, type FilterState } from "@/lib/filters/state";
import { MarketType, Verdict } from "@/lib/schemas";
import { TAXONOMY, TAXONOMY_TREE, type TaxNode } from "@/lib/taxonomy";
import { useProfile } from "@/lib/repo/hooks";
import { savePresetFromState } from "@/lib/presets";
import { suggestViewName } from "@/lib/presets-name";
import { UpgradeGate } from "@/components/UpgradeGate";
import { VERDICT_LABEL } from "@/components/market/labels";
import { queryFor, type Mode } from "./useScreener";
import { exactCount, formatCount } from "@/lib/format";

type Change = (p: Partial<FilterState>) => void;
type Props = { state: FilterState; mode: Mode; facets?: Facets; meta?: MetaResponse | null; onChange: Change; onReset: () => void };

const CATEGORIES = new Set(["sports", "crypto", "politics", "finance", "culture", "weather", "tech", "geopolitics", "other"]);
const toggle = <T,>(list: T[] | undefined, x: T): T[] | undefined => {
  const next = list?.includes(x) ? list.filter((y) => y !== x) : [...(list ?? []), x];
  return next.length ? next : undefined;
};
const SORTS: [string, FilterState["sort"]][] = [
  ["Best return", { key: "roi", dir: "desc" }], ["Most likely", { key: "win_prob", dir: "desc" }],
  ["Closing soon", { key: "closes", dir: "asc" }], ["Biggest payout", { key: "pays", dir: "desc" }],
];
const fmt = (n: number | undefined) => (n === undefined ? "" : String(n));

export function FilterPanel(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const active = countActive(props.state, props.mode);
  const show = () => {
    setOpen(true);
    dialog.current?.showModal();
  };
  // `f` shortcut (components/keyboard/Shortcuts.tsx) opens/closes the sheet; Best bets' "More sports" chip too.
  useEffect(() => {
    const toggle = () => {
      const d = dialog.current;
      if (d?.open) d.close();
      else {
        setOpen(true);
        d?.showModal();
      }
    };
    window.addEventListener("me:toggle-filters", toggle);
    return () => window.removeEventListener("me:toggle-filters", toggle);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={show}
        className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] ${active ? "border-accent-border bg-accent-bg text-accent-softer" : "border-border bg-surface text-soft hover:border-accent-border hover:text-text"}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        More filters{active ? ` (${active})` : ""}
      </button>
      <dialog
        ref={dialog}
        aria-label="Filters"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        onClose={() => setOpen(false)}
        className="m-0 mt-auto max-h-[88dvh] w-full max-w-none rounded-t-2xl border border-border bg-surface p-0 text-text backdrop:bg-black/60 md:ml-auto md:mt-0 md:h-dvh md:max-h-dvh md:w-[380px] md:rounded-none md:rounded-l-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-3">
          <h2 className="text-lg font-semibold">More filters</h2>
          {/* #9 (Nov 20): on Free most of the sheet is the Pro upgrade pitch; a plain ✕ closes it too (and Escape, and a
              click outside: native <dialog> + onClick above), so it never reads as a modal you can't leave */}
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-input bg-accent px-4 font-semibold text-on-accent">Done</button>
            <button type="button" aria-label="Close filters" data-testid="filters-close" onClick={() => dialog.current?.close()} className="flex size-11 items-center justify-center rounded-input text-muted hover:text-text">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>
        {open && <PanelBody {...props} />}
      </dialog>
    </>
  );
}

function countActive(s: FilterState, mode: Mode) {
  // "us" is shown on its own (Best bets' chip row); tier "best" is the page's default, not a choice
  const skip = new Set(["q", "tz", "v", "view", "sort", "page", "page_size", "win_prob_floor_default", "group_by_event", "side", "us", ...(mode === "flags" ? ["verdicts"] : [])]);
  return Object.entries(s).filter(([k, v]) => !skip.has(k) && v !== undefined && v !== false && !(k === "tier" && v === "best")).length + (s.side !== "best" ? 1 : 0);
}

function PanelBody({ state: s, mode, facets, meta, onChange, onReset }: Props) {
  const [saved, setSaved] = useState<"idle" | "saved" | "error">("idle");
  const save = async () => {
    try {
      await savePresetFromState(s, suggestViewName(s));   // #53: named after its filters, not "My view 3"
      setSaved("saved");
    } catch {
      setSaved("error");
    }
  };
  useEffect(() => setSaved("idle"), [s]);

  return (
    <div className="flex flex-col text-sm">
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <p className="text-xs text-muted">Every filter, with how many bets each leaves</p>
        <button type="button" onClick={onReset} className="min-h-11 px-2 text-[13px] text-muted hover:text-text">Reset</button>
      </div>

      <Section title="View">
        <div className="grid grid-cols-2 gap-1 rounded-input bg-input p-1" role="group" aria-label="View">
          {(["markets", "flags"] as const).map((v) => {
            const on = mode === v;
            const next = { ...s, view: v, page: 1, verdicts: v === "flags" ? undefined : s.verdicts };
            const href = (v === "flags" ? "/" : "/markets") + queryFor(v === "flags" ? { ...next, group_by_event: true } : { ...next, verdicts: undefined, group_by_event: true }, v);
            return (
              <Link key={v} href={href} aria-current={on ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-[9px] text-[13px] ${on ? "bg-accent-bg text-accent-soft" : "text-soft hover:text-text"}`}>
                {v === "markets" ? "All markets" : "Best bets"}
              </Link>
            );
          })}
        </div>
        <Check label="Group by event" on={s.group_by_event} onChange={(on) => onChange({ group_by_event: on })} />
        <Select label="Per page" value={String(s.page_size)} onChange={(v) => onChange({ page_size: Number(v) })}
          options={[["25", "25"], ["50", "50"], ...(s.group_by_event ? [] : [["100", "100"], ["200", "200"]] as [string, string][])]} />
      </Section>

      {mode === "flags" && (
        <Section title="Sort and where to bet">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort">
            {SORTS.map(([label, sort]) => (
              <Chip key={label} label={label} on={s.sort.key === sort.key && s.sort.dir === sort.dir} onClick={() => onChange({ sort })} />
            ))}
          </div>
          {meta?.meta.us?.ok === true && <Check label="On Polymarket US only" on={s.us} onChange={(on) => onChange({ us: on })} />}
        </Section>
      )}

      <Section title="Topics">
        <TopicTree s={s} facets={facets} onChange={onChange} />
      </Section>

      <Section title="Market type">
        {MarketType.options.map((t) => (
          <Check key={t} label={t} count={facets?.market_types[t]} on={!!s.market_types?.includes(t)} onChange={() => onChange({ market_types: toggle(s.market_types, t) })} />
        ))}
        <p className="mt-2 text-xs text-muted">Part of the game</p>
        <div className="flex flex-wrap gap-1.5">
          {PeriodEnum.options.map((p) => (
            <Chip key={p} label={p === "full" ? "Full game" : p} count={facets?.periods[p]} on={!!s.periods?.includes(p)} onClick={() => onChange({ periods: toggle(s.periods, p) })} />
          ))}
        </div>
      </Section>

      <Section title="Price & odds">
        <Select label="Which side" value={s.side} onChange={(v) => onChange({ side: v as FilterState["side"] })}
          options={[["best", "Better-priced side"], ["yes", "Yes / first side"], ["no", "No / second side"], ["favorite", "Favorite"], ["underdog", "Underdog"]]} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Price from" unit="%" value={s.price_min === undefined ? undefined : Math.round(s.price_min * 100)} min={0} max={100} onCommit={(v) => onChange({ price_min: v === undefined ? undefined : v / 100 })} />
          <Num label="to" unit="%" value={s.price_max === undefined ? undefined : Math.round(s.price_max * 100)} min={0} max={100} onCommit={(v) => onChange({ price_max: v === undefined ? undefined : v / 100 })} />
        </div>
        <Select label="Min win chance" value={s.win_prob_min === undefined ? "" : String(s.win_prob_min)} onChange={(v) => onChange({ win_prob_min: v === "" ? undefined : Number(v) })}
          options={[["0", "Any (show long shots)"], ["", "40% (default)"], ["0.55", "55%"], ["0.7", "70%"], ["0.8", "80% · likely to hit"], ["0.9", "90%"]]} />
      </Section>

      <UpgradeGate feature="all_filters">
        <Section title="Value">
          <Num label="Min price gap" unit="pts" step={0.5} value={s.edge_min === undefined ? undefined : Math.round(s.edge_min * 1000) / 10} onCommit={(v) => onChange({ edge_min: v === undefined ? undefined : v / 100 })} />
          <Num label="Min estimated return" unit="%" value={s.roi_min} onCommit={(v) => onChange({ roi_min: v })} />
          <Num label="Min past events behind it" value={s.min_events} min={0} step={10} onCommit={(v) => onChange({ min_events: v === undefined ? undefined : Math.round(v) })} />
          <Check label="Confident only (still good on the cautious estimate)" on={!!s.edge_low_positive} onChange={(on) => onChange({ edge_low_positive: on || undefined })} />
          <Check label="Tested on past data" on={!!s.validated_only} onChange={(on) => onChange({ validated_only: on || undefined })} />
        </Section>

        <Section title="Price check">
          <p className="text-xs text-muted">Best bets only: how much of the value is left at the price you would pay.</p>
          {Verdict.options.map((v) => (
            <Check key={v} label={VERDICT_LABEL[v]} count={facets?.verdicts[v]} on={!!s.verdicts?.includes(v)} onChange={() => onChange({ verdicts: toggle(s.verdicts, v) })} />
          ))}
          <Num label="Min value kept at the buy price" unit="%" min={0} max={100} value={s.retention_min === undefined ? undefined : Math.round(s.retention_min * 100)} onCommit={(v) => onChange({ retention_min: v === undefined ? undefined : v / 100 })} />
          <Num label="Min room at this price" unit="$" value={s.capacity_min_usd} min={0} step={100} onCommit={(v) => onChange({ capacity_min_usd: v })} />
        </Section>

        <Section title="Time">
          <p className="text-xs text-muted">Closes within</p>
          <div className="flex flex-wrap gap-1.5">
            {([1, 6, 24, 72, 168] as const).map((h) => (
              <Chip key={h} label={h < 48 ? `${h}h` : `${h / 24} days`} on={s.closes_within_h === h} onClick={() => onChange({ closes_within_h: s.closes_within_h === h ? undefined : h })} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Within (custom)" unit="h" value={s.closes_within_h} min={0} onCommit={(v) => onChange({ closes_within_h: v })} />
            <Num label="Closes after" unit="h" value={s.closes_after_h} min={0} onCommit={(v) => onChange({ closes_after_h: v })} />
          </div>
          <Check label="Live now" on={!!s.live_only} onChange={(on) => onChange({ live_only: on || undefined })} />
          <p className="mt-1 text-xs text-muted">Repeats</p>
          {FrequencyEnum.options.map((f) => (
            <Check key={f} label={{ recurring: "Recurring", "15M": "Every 15 min", hourly: "Hourly", daily: "Daily", weekly: "Weekly" }[f]} count={meta?.facets.frequency[f]} countTitle="open markets (all filters off)" on={!!s.frequency?.includes(f)} onChange={() => onChange({ frequency: toggle(s.frequency, f) })} />
          ))}
        </Section>

        <Section title="Activity">
          <Num label="Min volume" unit="$" min={0} step={1000} value={s.volume_min} onCommit={(v) => onChange({ volume_min: v })} />
          <Num label="Min 24h volume" unit="$" min={0} step={100} value={s.volume_24h_min} onCommit={(v) => onChange({ volume_24h_min: v })} />
          <Num label="Min liquidity" unit="$" min={0} step={1000} value={s.liquidity_min} onCommit={(v) => onChange({ liquidity_min: v })} />
          <Num label="Max gap between buy and sell price" unit="pts" min={0} step={0.5} value={s.spread_max === undefined ? undefined : Math.round(s.spread_max * 1000) / 10} onCommit={(v) => onChange({ spread_max: v === undefined ? undefined : v / 100 })} />
        </Section>

        <Section title="Mine">
          <Check label="My list only" on={!!s.watchlisted_only} onChange={(on) => onChange({ watchlisted_only: on || undefined })} />
          <Check label="My topics only" on={!!s.favorites_only} onChange={(on) => onChange({ favorites_only: on || undefined })} />
        </Section>
      </UpgradeGate>

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-surface p-4">
        <button type="button" onClick={save} className="min-h-11 rounded-input border border-accent-border bg-accent-bg font-semibold text-accent-soft hover:border-accent">
          Save as preset
        </button>
        <p aria-live="polite" className="text-center text-xs text-muted">{saved === "saved" ? "Saved to your presets." : saved === "error" ? "Couldn't save. Try again." : ""}</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="group border-t border-border first-of-type:border-t-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 font-semibold hover:text-accent-hover">
        {title}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="text-muted group-open:rotate-180"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-4">{children}</div>
    </details>
  );
}

function Count({ n, title }: { n?: number; title?: string }) {
  return n === undefined ? null : <span className="ml-auto pl-2 text-xs tabular-nums text-muted" title={title ?? exactCount(n)}>{formatCount(n)}</span>;
}

function Check({ label, on, onChange, count, countTitle }: { label: string; on: boolean; onChange: (on: boolean) => void; count?: number; countTitle?: string }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2.5 ${count === 0 && !on ? "text-muted" : "text-soft"} hover:text-text`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 flex-none accent-[var(--accent)]" />
      <span className="first-letter:uppercase">{label}</span>
      <Count n={count} title={countTitle} />
    </label>
  );
}

function Chip({ label, on, onClick, count }: { label: string; on: boolean; onClick: () => void; count?: number }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`min-h-11 rounded-full border px-3 text-[13px] ${on ? "border-accent-border bg-accent-bg text-accent-soft" : `border-border bg-input ${count === 0 ? "text-muted" : "text-soft"} hover:text-text`}`}>
      {label}{count !== undefined && <span className="ml-1 text-xs tabular-nums text-muted" title={exactCount(count)}>{formatCount(count)}</span>}
    </button>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 rounded-[10px] border border-border bg-input px-2.5 text-text focus:border-accent">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

/** Number field: commits on blur or Enter; empty = filter off. */
function Num({ label, unit, value, onCommit, min, max, step = 1 }: {
  label: string; unit?: string; value: number | undefined; onCommit: (v: number | undefined) => void; min?: number; max?: number; step?: number;
}) {
  const id = useId();
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const t = text.trim();
    const v = t === "" ? undefined : Number(t);
    if (v !== undefined && !Number.isFinite(v)) return setText(fmt(value));
    if (v !== value) onCommit(v);
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">{label}</label>
      <div className="flex items-center rounded-[10px] border border-border bg-input focus-within:border-accent">
        {unit === "$" && <span className="pl-2.5 text-muted" aria-hidden="true">$</span>}
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={text} placeholder="Any"
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()}
          className="min-h-11 w-full min-w-0 bg-transparent px-2.5 tabular-nums text-text placeholder:text-muted focus:outline-none" />
        {unit && unit !== "$" && <span className="pr-2.5 text-muted" aria-hidden="true">{unit}</span>}
      </div>
    </div>
  );
}

function TopicTree({ s, facets, onChange }: { s: FilterState; facets?: Facets; onChange: Change }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const favs = useProfile().favorite_topics.filter((id) => TAXONOMY[id]);
  const needle = q.trim().toLowerCase();
  const hit = (n: TaxNode): boolean => !needle || n.label.toLowerCase().includes(needle) || !!n.children?.some(hit);
  const isCat = (id: string) => CATEGORIES.has(id);
  const count = (id: string) => (isCat(id) ? facets?.categories[id] : facets?.topics[id]);
  const on = (id: string) => (isCat(id) ? !!s.categories?.includes(id as never) : !!s.topics?.includes(id));
  const flip = (id: string) => onChange(isCat(id) ? { categories: toggle(s.categories, id as never) } : { topics: toggle(s.topics, id) });

  const node = (n: TaxNode, depth: number): ReactNode => {
    if (!hit(n)) return null;
    const kids = n.children?.filter(hit);
    const row = (
      <div className="flex items-center gap-1 [&>label]:flex-1">
        <Check label={n.label} count={count(n.id)} on={on(n.id)} onChange={() => flip(n.id)} />
        {depth === 0 && isCat(n.id) && (
          <button type="button" aria-pressed={!!s.exclude_categories?.includes(n.id as never)}
            onClick={() => onChange({ exclude_categories: toggle(s.exclude_categories, n.id as never) })}
            className={`min-h-8 flex-none rounded-full px-2 text-xs ${s.exclude_categories?.includes(n.id as never) ? "bg-muted-bg text-warning" : "text-muted hover:text-text"}`}
            title={`Hide ${n.label}`}>
            {s.exclude_categories?.includes(n.id as never) ? "Hidden" : "Hide"}
          </button>
        )}
      </div>
    );
    if (!kids?.length) return <li key={n.id} className={depth === 0 ? "pl-8" : ""}>{row}</li>;
    const expanded = !!needle || open.has(n.id) || kids.some((k) => on(k.id));
    return (
      <li key={n.id}>
        <div className="flex items-center">
          <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${n.label}`}
            onClick={() => setOpen((o) => { const x = new Set(o); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}
            className="flex size-8 flex-none items-center justify-center text-muted hover:text-text">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={expanded ? "rotate-90" : ""}><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <div className="min-w-0 flex-1">{row}</div>
        </div>
        {expanded && <ul className="ml-4 border-l border-border pl-2">{kids.map((k) => node(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a topic" aria-label="Find a topic"
        className="min-h-11 rounded-[10px] border border-border bg-input px-2.5 text-text placeholder:text-muted focus:border-accent focus:outline-none" />
      {favs.length > 0 && !needle && (
        <div className="border-b border-border pb-2">
          <p className="text-xs text-muted">My topics</p>
          {favs.map((id) => <Check key={id} label={TAXONOMY[id]!.label} count={count(id)} on={on(id)} onChange={() => flip(id)} />)}
        </div>
      )}
      <ul className="flex flex-col">{TAXONOMY_TREE.map((n) => node(n, 0))}</ul>
    </>
  );
}
