// Odds conversions (docs/05 F-15, F-17): implied % ↔ multiplier ↔ decimal ↔ American.
// A Polymarket price p (0–1) pays $1, so implied chance = p and decimal odds = 1/p.
import { useCallback } from "react";
import { DASH, price } from "@/lib/format";
import { useProfile } from "@/lib/repo/hooks";
import type { OddsFormat } from "@/lib/repo/types";

const inRange = (p: number) => Number.isFinite(p) && p > 0 && p < 1;

export const toDecimal = (p: number): number | null => (inRange(p) ? 1 / p : null);
export const fromDecimal = (d: number): number | null => (Number.isFinite(d) && d > 1 ? 1 / d : null);
/** p ≥ 0.5 (favorite): −100·p/(1−p); else (underdog): +100·(1−p)/p */
export const toAmerican = (p: number): number | null =>
  !inRange(p) ? null : p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
export const fromAmerican = (a: number): number | null =>
  !Number.isFinite(a) || Math.abs(a) < 100 ? null : a < 0 ? -a / (-a + 100) : 100 / (a + 100);

export function formatOdds(p: number | null | undefined, fmt: OddsFormat): string {
  if (fmt === "cents") return price(p);
  if (typeof p !== "number" || !inRange(p)) return DASH;
  if (fmt === "percent") return `${+(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
  if (fmt === "decimal") return `${(1 / p).toFixed(2)}x`;
  const a = Math.round(toAmerican(p)!);
  return a > 0 ? `+${a}` : `−${Math.abs(a)}`;
}

export const ODDS_CHOICES: OddsFormat[] = ["percent", "decimal", "american"];
export const ODDS_LABEL: Record<OddsFormat, string> = {
  // "cents" stays a stored value (DB check constraint) but now shows as a percent and isn't offered (Q, Nov 20)
  cents: "Percent · 68%", percent: "Percent · 68%", decimal: "Multiplier · 1.47x", american: "American · −213",
};

/** Format a price in the user's odds format: `const odds = useOdds(); odds(0.68)`. Cents = format.price(). */
export function useOdds() {
  const { odds_format } = useProfile();
  return useCallback((p: number | null | undefined) => formatOdds(p, odds_format), [odds_format]);
}
