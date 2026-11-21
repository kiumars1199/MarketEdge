"use client";

// / "Best bets", rebuilt for a casual bettor on a phone (docs/OVERHAUL.md §B, §G2; T-302):
//   title + one sentence · one chip row (top 6 sports + More, Today / This week, Safer / Balanced / Bigger payouts,
//   On Polymarket US, More filters) · "Today's top 5" · "More bets" · on Free, one locked card where the free list ends.
// No tier or section jargon, no stat tiles: every number's basis is inside each card's "Why this bet?" and on
// /track-record (one link here). R2-6: a filter change keeps the current list on screen, dimmed and marked busy,
// until the new one arrives (no skeleton flash). The old Big payouts / More bets with an edge / Combos rows, closing-soon
// strip and results ticker are gone: "Bigger payouts" is a chip (best bets that win less often), lower-confidence
// bets come in through a payout filter (tierOf), Combos has its own page, results are one link away.
import { Ago } from "@/components/clock";   // QA-A #34: ticks, same clock on server and hydration
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ApiGroup, ApiRow, MarketsResponse } from "@/lib/api";
import { cardVenue, plainTitle, priceText, sideLabel } from "@/lib/card";
import type { FilterState } from "@/lib/filters/state";
import { formatCount } from "@/lib/format";
import { REFRESH_WORDS, freshness } from "@/lib/freshness";
import { savePresetFromState } from "@/lib/presets";
import { usePublishScan } from "@/lib/scanClock";
import { timeWindow } from "@/lib/search/parse";
import { TAXONOMY } from "@/lib/taxonomy";
import { BetCard } from "@/components/market/BetCard";
import { drawerHref, useOpenDrawer } from "@/components/market/drawer";
import { SaveViewDialog } from "@/components/presets/SaveViewDialog";
import { SavedViews } from "@/components/presets/SavedViews";
import { suggestViewName } from "@/lib/presets-name";
import { Count } from "@/components/kit";
import { CardSkeleton } from "@/components/market/bits";
import { SearchChips } from "@/components/search/SearchChips";
import { AppliedPills } from "./AppliedPills";
import { TodayCard } from "./DayStrip";
import { FilterPanel } from "./FilterPanel";
import { EmptyState, ErrorState, StaleBanner } from "./States";
import { useDesktop } from "./useDesktop";
import { LockedBets } from "./LockedBets";
import { FilterBar, barValues } from "./FilterBar";
import { queryFor, useMeta, useScreener } from "./useScreener";

const nf = formatCount;   // docs/18 §4: counts short, rounded down
const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
const TOP = 5;
const H = 3_600_000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** 44px chip (R2: tap targets), the same look as the other pills. */
const chip = (on: boolean) =>
  `inline-flex min-h-11 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm ${
    on ? "border-accent-border bg-accent-bg text-accent-soft" : "border-border bg-surface text-soft hover:border-accent-border hover:text-text"
  }`;

/** One slot per game: the best bet in it plus the others (when grouped), or one slot per bet (flat). */
type Slot = { rows: ApiRow[]; size: number };
function slotsOf(rows: ApiRow[], groups: ApiGroup[] | undefined): Slot[] {
  if (!groups) return rows.map((r) => ({ rows: [r], size: 1 }));
  return groups.map((g) => ({ rows: rows.slice(g.start, g.start + g.count), size: g.size })).filter((s) => s.rows.length);
}

/** "+3 more in this game": the other bets in the same game, inline under the card (docs/17 fix 2), in card words. */
function MoreInGame({ slot }: { slot: Slot }) {
  const [open, setOpen] = useState(false);
  const { open: openDrawer } = useOpenDrawer();
  const others = slot.rows.slice(1);
  if (slot.size < 2) return null;
  const ev = slot.rows[0]!.market;
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] text-accent-hover hover:text-accent-soft">
        {open ? "Hide" : `+${nf(slot.size - 1)} more in this game`}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      {open && (
        <ul className="flex flex-col rounded-xl border border-border bg-surface px-3 py-1 text-[13px]">
          {others.map(({ market: m, side: s }) => (
            <li key={`${m.id}:${s.side_index}`} className="border-b border-border last:border-0">
              <a href={drawerHref(m.id, s.side_index)} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openDrawer(m.id, s.side_index); }}
                className="flex min-h-11 flex-col justify-center py-2 hover:text-accent-hover">
                <span className="line-clamp-2">{plainTitle(m, s)}</span>
                <span className="text-xs text-muted">{sideLabel(s)} · pays {priceText(cardVenue(m, s).ask ?? s.ask)}</span>
              </a>
            </li>
          ))}
          {slot.size > slot.rows.length && (
            <li><a href={`/event/${ev.event_id}`} className="flex min-h-11 items-center text-accent-hover hover:text-accent-soft">All {nf(slot.size)} in this game</a></li>
          )}
        </ul>
      )}
    </div>
  );
}

function Cards({ slots, desktop, label }: { slots: Slot[]; desktop: boolean; label: string }) {
  return (
    <ul aria-labelledby={label} className={desktop ? GRID : "flex flex-col gap-3"}>
      {slots.map((s) => {
        const r = s.rows[0]!;
        return (
          // desktop: card and "+N more" sit in two subgrid rows, so a row of cards stays one height
          <li key={`${r.market.id}:${r.side.side_index}`} className={desktop ? "row-span-2 grid grid-rows-subgrid gap-y-1" : "flex flex-col gap-1"}>
            <BetCard r={r} />
            <MoreInGame slot={s} />
          </li>
        );
      })}
    </ul>
  );
}


/** Closing windows in the viewer's timezone, stored as hours from the scan (what the data measures from); the same
 *  arithmetic as the Closes pill on All markets (components/search/FilterPills.tsx). */
function windowFor(kind: "today" | "week", scannedAt: number | undefined) {
  if (!scannedAt) return { closes_after_h: undefined, closes_within_h: kind === "today" ? 24 : 168 };
  const scan = scannedAt * 1000;
  const w = timeWindow(kind, Math.max(scan, Date.now()), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const after = (w.from - scan) / H;
  return { closes_after_h: after > 0.05 ? r2(after) : undefined, closes_within_h: r2((w.to - scan) / H) };
}

/** AppliedPills leaves out what the filter bar already shows (its three values); anything else keeps its pill. */
function barPills(s: FilterState, win: Parameters<typeof barValues>[1]) {
  const v = barValues(s, win);
  return (key: string) =>
    (!!v.sport && (key === `topics:${v.sport.slice(2)}` || key === `categories:${v.sport.slice(2)}`)) ||
    (!!v.mult && key === "pays") ||
    (!!v.date && (key === "cw" || key === "ca"));
}

/** initial: the server's /api/flags page 1 for this URL, so the cards and the headline count are final on first
 *  paint (no client fetch, no LCP change). */
export function BestBets({ initial }: { initial?: { main: MarketsResponse; soon?: MarketsResponse; scanned_at?: number } }) {
  const sc = useScreener("flags", initial?.main);
  const { state, set, reset, error } = sc;
  const meta = useMeta();
  const desktop = useDesktop();
  // R2-6: keep the last answer on screen while the next one loads (dimmed, aria-busy), never a skeleton flash.
  const fresh = sc.data ? { data: sc.data, more: sc.more, moreGroups: sc.moreGroups } : null;
  const last = useRef(fresh);   // the last answer shown; a ref, so keeping it never re-renders
  if (fresh) last.current = fresh;
  const view = fresh ?? (sc.loading ? last.current : null);
  const data = view?.data;
  const busy = !fresh && !!view;
  const total = data?.total;
  // Free: the day's sample, then one locked card (docs/19 P3). Read from the server's answer (free_daily), never from
  // the client's tier: that is "free" until /api/me answers, which painted a paid page as "Free shows 89 …" (T-288).
  const daily = data?.free_daily;
  const sample = daily !== undefined;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; msg: string } | null>(null);

  const rows = data ? [...data.rows, ...view!.more] : [];
  const slots = data ? slotsOf(rows, data.groups ? [...data.groups, ...view!.moreGroups] : undefined) : [];
  // QA-A #70/#71: bets left, in bets (`total` counts bets; a game slot holds `size` of them), never below 0. Live
  // re-pricing can drop rows from a page, so whether a button shows comes from the pages held (sc.hasMore), not this.
  const left = data ? Math.max(0, data.total - slots.reduce((a, x) => a + x.size, 0)) : 0;
  // QA-A #46: the scan the cards on screen come from, never /api/meta's (another server may answer that one)
  const scanned = data?.scanned_at ?? initial?.scanned_at ?? meta?.meta.scanned_at;
  usePublishScan(scanned);   // the header pill names this same scan
  // §G2: the "On Polymarket US" chip exists once the scan carries US quotes (older scans: the filter is a no-op)
  const usOn = meta ? meta.meta.us?.ok === true : rows.some((r) => !!r.market.us);
  const win = useMemo(() => ({ today: windowFor("today", scanned), week: windowFor("week", scanned) }), [scanned]);
  const topic = state.topics?.length === 1 ? TAXONOMY[state.topics[0]!]?.label : state.categories?.length === 1 ? TAXONOMY[state.categories[0]!]?.label : undefined;

  const save = async (name: string, emoji: string | null) => {
    try {
      await savePresetFromState(state, name, emoji);
      setSaving(false);
      setSaved({ ok: true, msg: `Saved “${name}”` });
    } catch (e) {
      setSaved({ ok: false, msg: e instanceof Error ? e.message : "Couldn't save this view." });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">
          {/* P9: Free sees the day's sample, so the headline says "10 of 34", not a count it can't open */}
          {total !== undefined
            ? <>{sample && rows.length < total ? <>{rows.length} of </> : null}<Count n={total} /> {total === 1 ? "bet" : "bets"} where the odds lean your way</>
            : "Bets where the odds lean your way"}
        </h1>
        <p className="max-w-[760px] text-sm leading-normal text-muted">
          Each one has won more often in the past than its price suggests, after the fee.
          {/* P9: when the stale banner shows, it carries the scan age; saying it here too was the third stale notice */}
          {scanned && freshness(scanned) === "fresh" && <span className="whitespace-nowrap"> Updated <Ago at={scanned} />.</span>}{" "}
          <Link href="/track-record" className="inline-flex min-h-11 items-center text-accent-hover underline-offset-4 hover:underline">See how we track results</Link>
        </p>
      </section>

      <TodayCard />

      {/* Mark's filter bar (Nov 20): Sport · Multiplier · Date · Apply, then count and Sort */}
      <FilterBar state={state} facets={sc.facets} win={win} total={total} shown={sample ? rows.length : undefined} onChange={set} />
      <div role="group" aria-label="More filters" className="flex flex-wrap items-center gap-2">
        {usOn && (
          <button type="button" aria-pressed={state.us} data-testid="us-chip" className={chip(state.us)}
            title="Only bets you can place on Polymarket US, at its price and fee"
            onClick={() => set({ us: !state.us })}>
            {state.us && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>}
            On Polymarket US
          </button>
        )}
        <FilterPanel state={state} mode="flags" facets={sc.facets} meta={meta} onChange={set} onReset={reset} />
        <button type="button" onClick={() => (setSaved(null), setSaving(true))} className="inline-flex min-h-11 flex-none items-center whitespace-nowrap px-2 text-[13px] text-muted hover:text-text">+ Save this view</button>
        <SavedViews onApply={set} className="inline-flex min-h-11 flex-none items-center whitespace-nowrap px-2 text-[13px] text-muted hover:text-text" />
        <span role="status" className="text-[13px] text-accent-softer empty:hidden">{saved?.ok ? saved.msg : ""}</span>
      </div>
      <SaveViewDialog open={saving} title="Save this view" name={suggestViewName(state)} error={saved && !saved.ok ? saved.msg : null} onSubmit={save} onClose={() => setSaving(false)} />
      <SearchChips q={state.q} search={data?.search} onChange={set} />
      <AppliedPills state={state} mode="flags" onChange={set} onReset={reset} omit={barPills(state, win)} />
      <StaleBanner scannedAt={scanned} />

      {error && !data ? (
        <ErrorState onRetry={sc.retry} what="best bets" error={error} />
      ) : !data ? (
        <ul className={desktop ? GRID : "flex flex-col gap-3"} aria-busy="true" aria-label="Loading best bets">
          {Array.from({ length: desktop ? 8 : 4 }, (_, i) => <li key={i} className="flex"><CardSkeleton /></li>)}
        </ul>
      ) : data.total === 0 ? (
        <EmptyState
          title={topic ? `Nothing in ${topic} right now` : "No best bets match these filters"}
          line={`No bet with these filters is good value right now${state.us && usOn ? " on Polymarket US" : ""}. Prices refresh ${REFRESH_WORDS}.`}
          onReset={reset}
          link={state.us && usOn
            ? { href: "/" + queryFor({ ...state, us: false, page: 1 }, "flags"), label: "Include international bets" }
            : { href: "/markets", label: "Look in All markets" }}
        />
      ) : (
        <>
        {/* #45: the old list stays only as a dim backdrop that can't be used; a visible label says it is being replaced */}
        {busy && <p role="status" data-testid="bets-updating" className="sticky top-16 z-20 mx-auto -mb-2 rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-text shadow">Updating bets…</p>}
        <div data-testid="bets-list" aria-busy={busy} inert={busy || undefined} className={`flex flex-col gap-4 transition-opacity duration-200 ease-out ${busy ? "pointer-events-none opacity-40" : ""}`}>
          {error && <ErrorState onRetry={sc.retry} what="best bets" error={error} />}
          <h2 id="top-h" className="text-xl font-semibold">Today&apos;s top {Math.min(TOP, slots.length)}</h2>
          <Cards slots={slots.slice(0, TOP)} desktop={desktop} label="top-h" />
          {slots.length > TOP && (
            <>
              <h2 id="more-h" className="mt-2 text-xl font-semibold">More bets</h2>
              <Cards slots={slots.slice(TOP)} desktop={desktop} label="more-h" />
            </>
          )}
          {sample && <LockedBets total={data.total} shown={rows.length} daily={daily} />}
          {!sample && sc.hasMore && (
            <button
              type="button"
              onClick={sc.loadMore}
              disabled={sc.loadingMore}
              className="mx-auto min-h-11 rounded-xl border border-border bg-surface px-5 text-sm hover:border-accent-border"
            >
              {sc.loadingMore ? "Loading…" : left > 0 ? `Show more (${nf(left)} left)` : "Show more"}
            </button>
          )}
        </div>
        </>
      )}
    </div>
  );
}
