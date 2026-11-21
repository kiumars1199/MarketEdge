// Yearly savings on the plan cards (T-291 #15), computed from the owner's prices in config/site.json (prices_usd).
// Never hardcoded: change a price and every "save N%" label follows.
import type { SITE } from "@/lib/site";

export type Prices = typeof SITE.prices;

/** Whole percent saved by paying yearly instead of monthly × 12, rounded down so it is never overstated.
 *  0 when there is no monthly price or the yearly price saves nothing. */
export function yearlySavingPct(monthly: number, yearly: number): number {
  if (!(monthly > 0) || !(yearly >= 0)) return 0;
  return Math.max(0, Math.floor((1 - yearly / (12 * monthly)) * 100 + 1e-9));
}

/** Per-plan yearly saving, and the largest one (the toggle says "save up to N%"). */
export function yearlySavings(p: Prices): { pro: number; premium: number; max: number } {
  const pro = yearlySavingPct(p.pro_monthly, p.pro_yearly);
  const premium = yearlySavingPct(p.premium_monthly, p.premium_yearly);
  return { pro, premium, max: Math.max(pro, premium) };
}
