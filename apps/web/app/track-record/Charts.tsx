"use client";
// Results charts. Props arrive pre-shaped from the server page (lib/trackRecord.ts); no fetching here.
// Two series = accent (what happened / the model) vs market-bar grey (reference), always direct-labeled
// and backed by a table, since grey alone is low-contrast.
import { useId, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ret, exactCount, formatCount } from "@/lib/format";
import type { bucketRows, foldRows } from "@/lib/trackRecord";

const AXIS = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false } as const;
const GRID = <CartesianGrid stroke="var(--border)" vertical={false} />;
const TIP = {
  contentStyle: { background: "var(--raised)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)", fontSize: 13 },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--text)" },
  cursor: { fill: "var(--muted-bg)" },
} as const;

export function FoldCharts({ rows }: { rows: ReturnType<typeof foldRows> }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted">Average return that week</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={rows} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="week" hide />
          <YAxis {...AXIS} width={48} tickFormatter={(v: number) => ret(v)} />
          <ReferenceLine y={0} stroke="var(--muted)" />
          {/* no per-bar labels: 52 weeks of labels overlapped at every width; the value is one hover away */}
          <Tooltip {...TIP} formatter={(_v, _n, p) => [(p.payload as (typeof rows)[number]).retText, "Return"]} />
          <Bar dataKey="ret" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {rows.map((r) => <Cell key={r.week} fill={r.dir === "down" ? "var(--negative)" : r.dir === "up" ? "var(--accent)" : "var(--market-bar)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-muted">Best bets tested that week</p>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="week" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...AXIS} width={48} tickFormatter={(v: number) => formatCount(v)} />
          <Tooltip {...TIP} formatter={(v) => [Number(v).toLocaleString("en-US"), "Bets"]} />
          <Bar dataKey="bets" fill="var(--market-bar)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EdgeChart({ rows }: { rows: ReturnType<typeof bucketRows> }) {
  const cents = (v: unknown) => `${Number(v).toFixed(1)} pts`;
  return (
    <>
      <Legend items={[["var(--market-bar)", "Predicted"], ["var(--accent)", "Actually earned"]]} />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barGap={2}>
          {GRID}
          <XAxis dataKey="bucket" {...AXIS} />
          <YAxis {...AXIS} width={40} tickFormatter={(v: number) => `${v} pts`} />
          <Tooltip {...TIP} formatter={(v, n) => [cents(v), n === "predicted" ? "Predicted" : "Actually earned"]}
            labelFormatter={(l) => `Predicted edge ${l} per $1 share`} />
          <Bar dataKey="predicted" fill="var(--market-bar)" radius={[4, 4, 0, 0]} maxBarSize={36}>
            <LabelList dataKey="predicted" position="top" fill="var(--muted)" fontSize={11} formatter={cents} />
          </Bar>
          <Bar dataKey="realized" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={36}>
            <LabelList dataKey="realized" position="top" fill="var(--soft)" fontSize={11} formatter={cents} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

export interface CalibrationSet { label: string; byH: Record<string, { points: { price: number; win_prob: number }[]; events: number } | null> }

const H_LABEL: Record<string, string> = { "1": "~1 hour", "6": "~6 hours", "24": "~1 day", "72": "~3 days", "168": "~1 week" };

export function CalibrationChart({ sets }: { sets: Record<string, CalibrationSet> }) {
  const [cat, setCat] = useState("all");
  const [h, setH] = useState("24");
  const id = useId();
  const c = sets[cat]?.byH[h] ?? null;
  const data = c?.points.map((p) => ({ price: Math.round(p.price * 100), won: Math.round(p.win_prob * 1000) / 10, fair: Math.round(p.price * 100) }));
  const select = "min-h-11 rounded-input border border-border bg-input px-3 text-text";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted" htmlFor={`${id}c`}>Category
          <select id={`${id}c`} value={cat} onChange={(e) => setCat(e.target.value)} className={select}>
            {Object.entries(sets).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted" htmlFor={`${id}h`}>Time before close
          <select id={`${id}h`} value={h} onChange={(e) => setH(e.target.value)} className={select}>
            {Object.entries(H_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <Legend items={[["var(--market-bar)", "Fair line (price = win chance)"], ["var(--accent)", "How often they won"]]} />
      </div>
      {data ? (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" />
              <XAxis dataKey="price" type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} tickFormatter={(v: number) => `${v}%`} />
              <YAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} width={44} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip {...TIP} cursor={{ stroke: "var(--muted)" }} labelFormatter={(l) => `Priced at ${l}%`}
                formatter={(v, n) => [`${v}%`, n === "won" ? "Won" : "Fair"]} />
              <Line dataKey="fair" stroke="var(--market-bar)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line dataKey="won" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted">Based on <span title={exactCount(c!.events)}>{formatCount(c!.events)}</span> past events. Above the dashed line, bets at that price won more often than the price implied.</p>
        </>
      ) : (
        <p className="rounded-inner border border-border bg-raised p-6 text-sm text-muted">Not enough past markets in this category at this time before close to draw a curve.</p>
      )}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map(([color, label]) => (
        <li key={label} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" />{label}</li>
      ))}
    </ul>
  );
}
