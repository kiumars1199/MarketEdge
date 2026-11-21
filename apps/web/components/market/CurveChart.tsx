"use client";

// Segment win-chance curve vs the fair diagonal, with this bet's price marked (F-04 § Why).
import { CartesianGrid, Line, LineChart, ReferenceDot, Tooltip, XAxis, YAxis } from "recharts";
import type { Curve } from "@/lib/api";
import { pct, price } from "@/lib/format";

export function CurveChart({ curve, ask, winProb }: { curve: Curve; ask: number; winProb: number }) {
  const data = curve.points.map((p) => ({ price: p.price, won: p.win_prob, fair: p.price }));
  return (
    <figure className="m-0">
      {/* docs/17 fix 12: legend above the chart, so it is never cut off at the bottom of the drawer */}
      <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-accent" />How often similar bets won</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0 w-4 border-t border-dashed border-market-bar" />Fair price</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-accent-soft" />This bet</span>
      </figcaption>
      <div className="h-[200px] w-full" role="img" aria-label={`Chart: at a ${price(ask)} price, similar bets won ${pct(winProb)} of the time. A fair price would win ${pct(ask)}.`}>
        <LineChart responsive style={{ width: "100%", height: "100%" }} data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="price" type="number" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => price(v)} stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} />
            <YAxis type="number" domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v: number) => pct(v)} stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "var(--raised)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
              labelFormatter={(v) => `Price ${price(Number(v))}`}
              formatter={(v, name) => [pct(Number(v)), name === "won" ? "Similar bets won" : "Fair (price = chance)"]}
            />
            <Line dataKey="fair" stroke="var(--market-bar)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line dataKey="won" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <ReferenceDot x={ask} y={winProb} r={5} fill="var(--accent-soft)" stroke="var(--background)" strokeWidth={2} />
          </LineChart>
      </div>
    </figure>
  );
}
