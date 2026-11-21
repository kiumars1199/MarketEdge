"use client";
// Sign-ups per day, last 30 days (T-141). One series: no legend, the heading names it; value one hover away.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false } as const;
export interface SignupDay { day: string; n: number; label: string }

export default function SignupsChart({ rows }: { rows: SignupDay[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...AXIS} width={32} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "var(--muted-bg)" }}
          contentStyle={{ background: "var(--raised)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)", fontSize: 13 }}
          labelStyle={{ color: "var(--muted)" }} itemStyle={{ color: "var(--text)" }}
          formatter={(v) => [Number(v).toLocaleString("en-US"), "Sign-ups"]}
        />
        <Bar dataKey="n" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}
