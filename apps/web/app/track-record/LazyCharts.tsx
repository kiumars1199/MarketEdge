"use client";
// T-295: Recharts (~100 kB gzipped) loads after the page instead of with it. The charts sit below the tiles and
// ResponsiveContainer draws nothing on the server anyway (no width there), so nothing visible is lost. Each placeholder
// holds the chart's measured height (412 px and 1350 px wide; the calibration controls wrap to two rows on a phone) so
// the page does not jump when it arrives; the tables under each chart are server-rendered.
import dynamic from "next/dynamic";

const box = (h: string) => function ChartLoading() {
  return <div aria-hidden="true" className={`animate-pulse rounded-inner bg-muted-bg ${h}`} />;
};

export const FoldCharts = dynamic(() => import("./Charts").then((m) => m.FoldCharts), { ssr: false, loading: box("h-[374px]") });
export const EdgeChart = dynamic(() => import("./Charts").then((m) => m.EdgeChart), { ssr: false, loading: box("h-[272px]") });
export const CalibrationChart = dynamic(() => import("./Charts").then((m) => m.CalibrationChart), { ssr: false, loading: box("h-[448px] md:h-[404px]") });
