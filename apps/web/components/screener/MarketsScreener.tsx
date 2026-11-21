"use client";

// /markets "All markets" (F-01): grouped rows on desktop, compact cards on mobile, URL-driven.
import { Ago } from "@/components/clock";
import { useEffect, useMemo, useState } from "react";
import { fetchEvent, groupRows, type ApiGroup, type ApiRow, type MarketsResponse } from "@/lib/api";
import { pickSide, sideOk } from "@/lib/filters/apply";
import { defaultState } from "@/lib/filters/state";
import { formatCount } from "@/lib/format";
import { useProfile } from "@/lib/repo/hooks";
import { PresetBar } from "@/components/presets/PresetBar";
import { QuickChips } from "@/components/presets/QuickChips";
import { ExportCsv } from "@/components/presets/ExportCsv";
import { MarketCard } from "@/components/market/MarketCard";
import { Skeleton } from "@/components/market/bits";
import { FilterPills } from "@/components/search/FilterPills";
import { SearchChips } from "@/components/search/SearchChips";
import { AppliedPills } from "./AppliedPills";
import { MarketTable, type Item } from "./MarketTable";
import { EmptyState, ErrorState, StaleBanner } from "./States";
import { useDesktop } from "./useDesktop";
import { useMeta, useScreener } from "./useScreener";
import { usePublishScan } from "@/lib/scanClock";
import { SortNote } from "./SortNote";

type Expanded = Record<string, { rows?: ApiRow[]; loading?: boolean }>;

/** initial: the server's /api/markets page 1 for this URL (no first fetch). */
export function MarketsScreener({ initial, scannedAt }: { initial?: MarketsResponse; scannedAt?: number } = {}) {
  const sc = useScreener("markets", initial);
  const { state, set, reset, data, loading, error } = sc;
  const meta = useMeta();
  const desktop = useDesktop();
  const pro = useProfile().numbers_mode === "pro";

  const [expanded, setExpanded] = useState<Expanded>({});
  useEffect(() => setExpanded({}), [data]);

  const toggle = async (g: ApiGroup) => {
    if (expanded[g.event_id]?.rows) return setExpanded(({ [g.event_id]: _, ...rest }) => rest);
    setExpanded((e) => ({ ...e, [g.event_id]: { loading: true } }));
    try {
      const ev = await fetchEvent(g.event_id);
      const shown = new Set(groupRows(data!, g).map((r) => r.market.id));
      const rows = ev.markets.flatMap((m) => {
        const side = pickSide(m, state.side);
        return !shown.has(m.id) && side && sideOk(side, state) ? [{ market: m, side }] : [];
      });
      setExpanded((e) => ({ ...e, [g.event_id]: { rows } }));
    } catch {
      setExpanded(({ [g.event_id]: _, ...rest }) => rest);
    }
  };

  const items = useMemo<Item[]>(() => {
    if (!data) return [];
    if (!data.groups) return data.rows.map((r) => ({ kind: "row", r }));
    return data.groups.flatMap((g) => {
      const ex = expanded[g.event_id];
      const out: Item[] = [{ kind: "group", g }, ...groupRows(data, g).map((r): Item => ({ kind: "row", r })), ...(ex?.rows ?? []).map((r): Item => ({ kind: "row", r }))];
      const hidden = g.size - g.count;
      if (hidden > 0) out.push({ kind: "more", g, hidden, expanded: !!ex?.rows, loading: ex?.loading });
      return out;
    });
  }, [data, expanded]);

  // QA-A #46: the scan the rows on screen come from; the header pill names the same one
  const scanned = data?.scanned_at ?? scannedAt ?? meta?.meta.scanned_at;
  usePublishScan(scanned);
  return (
    <div className="mx-auto flex w-full max-w-[1600px] gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">All markets</h1>
            <p className="mt-1 text-sm text-muted">
              {data ? `${formatCount(data.total)} ${data.total === 1 ? "market matches" : "markets match"}` : "Loading markets…"}
              {meta && <> · {formatCount(meta.counts.markets)} open · scanned <Ago at={scanned} /></>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportCsv state={state} />
          </div>
        </header>
        <FilterPills state={state} mode="markets" facets={sc.facets} meta={meta} onChange={set} onReset={reset} />
        <PresetBar state={state} onChange={set} />
        <QuickChips state={state} onChange={set} />
        <SearchChips q={state.q} search={data?.search} onChange={set} />
        <AppliedPills state={state} mode="markets" onChange={set} onReset={reset} />
        <SortNote />
        <StaleBanner scannedAt={scanned} />

        {error && !data ? (
          <ErrorState onRetry={sc.retry} error={error} />
        ) : !data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading markets">
            {/* #9 (Nov 20): a filter change says it is loading, as Best bets' "Updating bets…" does */}
            <p role="status" data-testid="markets-updating" className="text-sm font-medium text-soft">Loading markets…</p>
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : data.total === 0 ? (
          <EmptyState
            title={state.q ? "No matches in open markets" : "No markets match these filters"}
            line={state.q ? `Nothing open matches “${state.q}” with the filters you have on. Clear the filters to search every open market.` : "Every open market is hidden by at least one filter. Remove a filter above, or start over."}
            onReset={state.q ? () => set({ ...defaultState(), q: state.q }) : reset}
            resetLabel={state.q ? "Clear filters, keep search" : undefined}
          />
        ) : (
          <>
            {error && <ErrorState onRetry={sc.retry} error={error} />}
            {desktop ? (
              <MarketTable items={items} sort={state.sort} onSort={(sort) => set({ sort })} onToggleGroup={toggle} pro={pro} loading={loading} />
            ) : (
              <ul className={`flex flex-col gap-2.5 ${loading ? "opacity-60" : ""}`}>
                {items.map((it) =>
                  it.kind === "group" ? (
                    <li key={`g${it.g.event_id}`} className="px-1 pt-3 font-heading text-sm font-semibold text-soft">{it.g.event}</li>
                  ) : it.kind === "row" ? (
                    <li key={`${it.r.market.id}:${it.r.side.side_index}`}><MarketCard r={it.r} pro={pro} /></li>
                  ) : (
                    <li key={`m${it.g.event_id}`}>
                      <button type="button" onClick={() => toggle(it.g)} aria-expanded={it.expanded} className="min-h-11 px-1 text-[13px] text-accent-hover">
                        {it.loading ? "Loading…" : it.expanded ? "Show fewer" : `+${formatCount(it.hidden)} more in this event`}
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}
            <Pager page={data.page} pages={data.pages} onPage={(page) => set({ page })} />
          </>
        )}
      </div>
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btn = "min-h-11 rounded-input border border-border bg-surface px-4 hover:border-accent-border disabled:opacity-40 disabled:hover:border-border";
  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-3 py-2 text-sm">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="text-muted">Page {page} of {pages}</span>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}
