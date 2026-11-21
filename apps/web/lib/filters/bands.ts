// Payout bands (docs/04 § Facets). Their own module (T-295): bet cards on every page read paysBand, and importing it
// from ./apply pulled the filter state schemas and zod into the landing bundle. ./apply re-exports these.
import type { PaysBand, Side } from "@/lib/types";

/** docs/18 §3 payout bands: [key, label, min, max]. */
export const PAYS_BANDS: [string, string, number, number][] = [
  ["<1.5x", "Under 1.5x", 1, 1.5], ["1.5-2x", "1.5–2x", 1.5, 2], ["2-3x", "2–3x", 2, 3],
  ["3-5x", "3–5x", 3, 5], ["5-10x", "5–10x", 5, 10], ["10x+", "10x+", 10, Infinity],
];
export const band = (bands: [string, string, number, number][], x: number) => bands.find(([, , lo, hi]) => x >= lo && x < hi)?.[0] ?? (x >= 1 ? bands[0]![0] : undefined);
export const paysBand = (s: Pick<Side, "ask">) => (s.ask > 0 ? (band(PAYS_BANDS, 1 / s.ask) as PaysBand | undefined) : undefined);
