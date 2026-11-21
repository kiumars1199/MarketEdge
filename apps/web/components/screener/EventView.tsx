"use client";

// /event/[id] (T-25): every market in one event, same table as /markets; weather events add a bucket chart.
import { ClosesLine } from "@/components/clock";
import { ExternalLink } from "@/components/kit/icons";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { topicCrumb } from "@/components/market/labels";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import type { EventResponse } from "@/lib/api";
import { comparator } from "@/lib/filters/apply";
import type { FilterState } from "@/lib/filters/state";
import { formatCount, pct } from "@/lib/format";
import { useProfile } from "@/lib/repo/hooks";
import { MarketCard } from "@/components/market/MarketCard";
import { MarketTable } from "./MarketTable";
import { useDesktop } from "./useDesktop";

// "… be 28°C on …", "… 70–71°F …", "… 18°C or higher …": the bucket is the temperature text in the question.
const BUCKET = /(-?\d+(?:[–-]\d+)?°[CF](?: or (?:higher|below|lower))?)/;

function BucketChart({ ev }: { ev: EventResponse }) {
  const data = ev.markets.flatMap((m) => {
    const b = m.question.match(BUCKET)?.[1];
    const yes = m.sides[0];
    return b && yes ? [{ b, says: yes.ask, won: yes.win_prob }] : [];
  }).sort((x, y) => parseFloat(x.b) - parseFloat(y.b) || (/below|lower/.test(x.b) ? -1 : /higher/.test(x.b) ? 1 : 0));
  if (data.length < 3) return null;
  return (
    <figure className="m-0 rounded-card border border-border bg-surface p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-sans text-sm font-semibold">Each temperature range: market&apos;s odds vs how often it won before</span>
        <span className="flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-market-bar" />Market says</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-accent" />Won before</span>
        </span>
      </figcaption>
      <div className="h-[220px] w-full" role="img" aria-label={`Chart of ${data.length} temperature ranges: market price vs how often similar ranges won.`}>
        <ComposedChart responsive style={{ width: "100%", height: "100%" }} data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="b" stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v: number) => pct(v)} stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "var(--raised)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
            formatter={(v, name) => [pct(Number(v)), name === "won" ? "Won before" : "Market says"]}
          />
          <Bar dataKey="says" fill="var(--market-bar)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line dataKey="won" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} isAnimationActive={false} />
        </ComposedChart>
      </div>
    </figure>
  );
}

export function EventView({ ev }: { ev: EventResponse }) {
  const [sort, setSort] = useState<FilterState["sort"]>({ key: "roi", dir: "desc" });
  const desktop = useDesktop();
  const pro = useProfile().numbers_mode === "pro";
  const flagged = new Set(ev.flags.filter((f) => f.execution?.verdict !== "not worth it").map((f) => f.id));
  const rows = ev.markets.map((m) => ({ market: ev.flags.find((f) => f.id === m.id) ?? m, side: m.best })).sort(comparator(sort));
  const first = ev.markets[0];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <header>
        <Breadcrumbs className="mb-3" items={[{ label: "Best bets", href: "/bets" }, ...(first ? [topicCrumb(first)] : []), { label: ev.event }]} />
        {first && <p className="text-xs text-muted"><ClosesLine at={first.closes_at} cap /></p>}
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">{ev.event}</h1>
        <p className="mt-1.5 text-sm text-muted">
          {flagged.size > 0
            ? `${formatCount(flagged.size)} of ${formatCount(ev.markets.length)} ${ev.markets.length === 1 ? "market is a" : "markets are"} best ${flagged.size === 1 ? "bet" : "bets"}.`
            : `${formatCount(ev.markets.length)} open ${ev.markets.length === 1 ? "market" : "markets"}; none is priced below how often similar bets won.`}
          {ev.slug && (
            <> <a href={`https://polymarket.com/event/${ev.slug}`} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-accent-hover hover:text-accent-soft">Open on Polymarket <ExternalLink size={14} className="inline-block align-[-2px]" /></a></>
          )}
        </p>
      </header>
      {first?.category === "weather" && <BucketChart ev={ev} />}
      {desktop ? (
        <MarketTable items={rows.map((r) => ({ kind: "row" as const, r }))} sort={sort} onSort={setSort} pro={pro} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => <li key={r.market.id}><MarketCard r={r} pro={pro} /></li>)}
        </ul>
      )}
    </div>
  );
}
