"use client";
// Dashboard panel kinds (docs/05 F-10). Each panel fetches its own data and links to its full view.
import { ClosesLine } from "@/components/clock";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { drawerHref } from "@/components/market/drawer";
import { fetchCurve, fetchMarkets, type ApiRow, type Curve } from "@/lib/api";
import { DASH, edge, money, pct, price, ret, sideEdge, formatCount } from "@/lib/format";
import { betQuote } from "@/lib/betFigures";
import type { FilterState } from "@/lib/filters/state";
import { summarize } from "@/lib/journal";
import { useCollection, useProfile } from "@/lib/repo/hooks";
import type { DashboardPanel } from "@/lib/repo/types";
import { viewById, viewHref } from "@/lib/views";
import { Count } from "@/components/kit";

export const PANEL_KINDS = {
  preset_table: "Top markets in a view",
  kpi: "Key numbers for a view",
  watchlist: "My list",
  calibration_chart: "How often bets won, by price",
  journal_summary: "My bets summary",
  alerts_inbox: "Latest alerts",
} as const;
export type PanelKind = keyof typeof PANEL_KINDS;
export const needsView = (k: string) => k === "preset_table" || k === "kpi";

/** Fetch helper that refetches when the key changes and every 2 minutes (follows the scan). */
function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [s, setS] = useState<{ key: string | null; data?: T; error?: boolean }>({ key: null });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const run = () => load().then((data) => live && setS({ key, data }), () => live && setS({ key, error: true }));
    run();
    const t = setInterval(run, 120_000);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s.key === key ? s : { key, data: undefined, error: false };
}

export function panelTitle(p: DashboardPanel, presets: ReturnType<typeof useCollection<"presets">>) {
  if (p.title) return p.title;
  const v = viewById(p.preset_id, presets);
  if (p.kind === "calibration_chart") return `How often bets won · ${segName((p.query as { segment?: string })?.segment ?? "all")}`;
  return v && needsView(p.kind) ? `${v.name}` : PANEL_KINDS[p.kind as PanelKind] ?? p.kind;
}

export function fullViewHref(p: DashboardPanel, presets: ReturnType<typeof useCollection<"presets">>): string {
  const v = viewById(p.preset_id, presets);
  switch (p.kind) {
    case "preset_table": case "kpi": return v ? viewHref(v.state) : "/markets";
    case "watchlist": return "/watchlist";
    case "calibration_chart": return "/track-record";
    case "journal_summary": return "/journal";
    case "alerts_inbox": return "/alerts?tab=inbox";
    default: return "/";
  }
}

export const segName = (s: string) => (s === "all" ? "all markets" : s.startsWith("cat:") ? s.slice(4) : s.toUpperCase());

const Muted = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-muted">{children}</p>;
const Loading = () => (
  <div className="flex flex-col gap-2 py-1" aria-label="Loading">
    {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-input bg-muted-bg" />)}
  </div>
);
const Failed = () => <Muted>Couldn&apos;t load this panel. It retries every 2 minutes.</Muted>;

function MarketRows({ rows, pro }: { rows: ApiRow[]; pro: boolean }) {
  const pathname = usePathname();
  return (
    <ul className="divide-y divide-border">
      {rows.map(({ market: m, side: s }) => (
        <li key={`${m.id}:${s.side_index}`}>
          <Link href={pathname + drawerHref(m.id, s.side_index)} scroll={false} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent-hover">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{m.question}</span>
              <span className="text-xs text-muted">Bet {s.outcome} · pays {betQuote(m, s).paysText ?? DASH} · Won before {pct(s.win_prob)} · <ClosesLine at={m.closes_at} /></span>
            </span>
            <span className={`flex-none font-heading text-lg font-bold tabular-nums ${(betQuote(m, s).roi ?? 0) > 0 ? "text-accent" : "text-muted"}`}>{pro ? sideEdge(s) : betQuote(m, s).retText}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PresetTable({ state }: { state: FilterState }) {
  const pro = useProfile().numbers_mode === "pro";
  const q = { ...state, group_by_event: false, page: 1, page_size: 6 };
  const r = useLoad(JSON.stringify(q), () => fetchMarkets(q));
  if (r.error) return <Failed />;
  if (!r.data) return <Loading />;
  if (!r.data.rows.length) return <Muted>Nothing matches this view right now.</Muted>;
  return <><p className="text-xs text-muted"><Count n={r.data.total} /> matching</p><MarketRows rows={r.data.rows} pro={pro} /></>;
}

function Kpi({ state }: { state: FilterState }) {
  const base = { ...state, group_by_event: false, page: 1, page_size: 1 };
  const best = { ...base, sort: { key: "roi" as const, dir: "desc" as const } };
  const soon = { ...base, closes_within_h: Math.min(6, state.closes_within_h ?? 6) };
  const r = useLoad(JSON.stringify(base), () => Promise.all([fetchMarkets(best), fetchMarkets(soon)]));
  if (r.error) return <Failed />;
  if (!r.data) return <Loading />;
  const [a, b] = r.data;
  const top = a.rows[0]?.side.roi_pct;
  const cell = (label: string, value: string, accent = false) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-heading text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums ${accent ? "text-accent" : ""}`}>{value}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-4 py-2">
      {cell(state.view === "flags" ? "Best bets" : "Markets", formatCount(a.total))}
      {cell("Best estimated return", ret(top), true)}
      {cell("Closing in 6 h", formatCount(b.total))}
    </div>
  );
}

function Watchlist() {
  const items = useCollection("watchlist");
  const pathname = usePathname();
  if (!items.length) return <Muted>Nothing saved yet. Save any market to see it here.</Muted>;
  return (
    <ul className="divide-y divide-border">
      {items.slice(0, 8).map((w) => {
        const snap = (w.snapshot ?? {}) as { question?: string; ask?: number; win_prob?: number };
        return (
          <li key={w.id}>
            <Link href={pathname + drawerHref(w.market_id, w.side_index ?? undefined)} scroll={false} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent-hover">
              <span className="truncate">{snap.question ?? `Market ${w.market_id}`}</span>
              <span className="flex-none text-muted tabular-nums">{price(snap.ask)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Calibration({ segment, h }: { segment: string; h: number }) {
  const r = useLoad(`${segment}|${h}`, () => fetchCurve(segment, h));
  if (r.error) return <Muted>No curve for {segName(segment)} at this horizon.</Muted>;
  if (!r.data) return <Loading />;
  const c = r.data as Curve;
  const data = c.points.map((p) => ({ price: Math.round(p.price * 100), won: Math.round(p.win_prob * 1000) / 10, fair: Math.round(p.price * 100) }));
  return (
    <div className="flex h-full min-h-48 flex-col gap-2">
      <p className="text-xs text-muted"><Count n={c.neff} /> eff. samples · <Count n={c.events} /> events · ~{c.horizon_h} h out. Above the dashed line = won more often than the price said.</p>
      <div className="min-h-40 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="price" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
            <YAxis stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }} labelFormatter={(v) => `Priced at ${v}%`} formatter={(v, k) => [`${v}%`, k === "won" ? "Won before" : "Market says"]} />
            <Line dataKey="fair" stroke="var(--market-bar)" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line dataKey="won" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function JournalSummary() {
  const rows = useCollection("journal");
  const pro = useProfile().numbers_mode === "pro";
  if (!rows.length) return <Muted>No bets logged yet. Use “Log this bet” in any market.</Muted>;
  const s = summarize(rows);
  const tone = (x: number | null) => (x === null || x === 0 ? "" : x > 0 ? "text-positive" : "text-negative");
  const cell = (label: string, value: string, cls = "") => (
    <div className="flex flex-col gap-1"><span className="text-xs text-muted">{label}</span><span className={`font-heading text-2xl font-bold tabular-nums ${cls}`}>{value}</span></div>
  );
  return (
    <div className="grid grid-cols-2 gap-4 py-2 sm:grid-cols-4">
      {cell("Profit / loss", s.settled ? money(s.pnl, true) : DASH, tone(s.pnl))}
      {cell("Return", ret(s.roi), tone(s.roi))}
      {cell("Win rate", pct(s.win_rate))}
      {cell("Vs closing", pro ? edge(s.avg_clv) : s.avg_clv === null ? DASH : s.avg_clv >= 0 ? "Beating it" : "Behind it", tone(s.avg_clv))}
    </div>
  );
}

function AlertsInbox() {
  const events = useCollection("alert_events");
  const pathname = usePathname();
  const last = [...events].sort((a, b) => b.fired_at.localeCompare(a.fired_at)).slice(0, 6);
  if (!last.length) return <Muted>No alerts yet. Set one up under Alerts.</Muted>;
  return (
    <ul className="divide-y divide-border">
      {last.map((e) => {
        const p = (e.payload ?? {}) as { title?: string; message?: string };
        return (
          <li key={e.id}>
            <Link href={pathname + drawerHref(e.market_id, e.side_index ?? undefined)} scroll={false} className="block py-2.5 text-sm hover:text-accent-hover">
              <span className={`block truncate ${e.read_at ? "" : "font-semibold"}`}>{p.title ?? e.market_id}</span>
              <span className="block truncate text-xs text-muted">{p.message}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PanelBody({ panel }: { panel: DashboardPanel }) {
  const presets = useCollection("presets");
  const view = viewById(panel.preset_id, presets);
  switch (panel.kind) {
    case "preset_table": return view ? <PresetTable state={view.state} /> : <Muted>This view was deleted.</Muted>;
    case "kpi": return view ? <Kpi state={view.state} /> : <Muted>This view was deleted.</Muted>;
    case "watchlist": return <Watchlist />;
    case "calibration_chart": {
      const q = (panel.query ?? {}) as { segment?: string; h?: number };
      return <Calibration segment={q.segment ?? "all"} h={q.h ?? 24} />;
    }
    case "journal_summary": return <JournalSummary />;
    case "alerts_inbox": return <AlertsInbox />;
    default: return <Muted>Unknown panel.</Muted>;
  }
}

