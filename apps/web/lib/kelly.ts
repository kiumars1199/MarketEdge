// Kelly sizing (docs/05 F-13). Math on the user's own bankroll and fraction, not a recommendation.
// Buying at price p (incl. fee) with win chance q, payout $1/share:
//   f* = (q − p) / (1 − p);  stake = bankroll × fraction × max(0, f*), capped at capacity;  shares = stake / p

export interface KellyInput {
  q: number;                    // win chance (0–1)
  p: number;                    // cost per share incl. fee (0–1)
  bankroll: number;             // USD
  fraction: number;             // 0.25 = quarter Kelly
  capacity?: number | null;     // live book capacity_usd: never size above it
}
export interface KellyResult { f_star: number; stake: number; shares: number; capped: boolean }

export function kelly({ q, p, bankroll, fraction, capacity }: KellyInput): KellyResult | null {
  if (![q, p, bankroll, fraction].every(Number.isFinite) || !(p > 0 && p < 1) || !(q >= 0 && q <= 1) || bankroll < 0 || fraction < 0) return null;
  const f_star = (q - p) / (1 - p);
  let stake = bankroll * fraction * Math.max(0, f_star);
  const capped = capacity != null && Number.isFinite(capacity) && stake > capacity;
  if (capped) stake = Math.max(0, capacity);
  return { f_star, stake, shares: stake / p, capped };
}

/** price incl. Polymarket taker fee: p + rate·p·(1−p) */
export const withFee = (price: number, rate: number) => price + rate * price * (1 - price);
