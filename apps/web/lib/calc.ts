// /tools calculators (docs/05 F-15). Pure, client-side. Fee per share = rate × p × (1 − p) (lib/execution.ts).
const ok = (...xs: number[]) => xs.every(Number.isFinite);

export const feePerShare = (p: number, rate: number) => rate * p * (1 - p);

export interface ReturnResult {
  fee: number;          // per share
  cost: number;         // price + fee
  edge: number;         // win chance − cost, per $1 share
  roi_pct: number;      // estimated return: edge / cost × 100
  profit_100: number;   // profit on a $100 bet at the given win chance
  break_even: number;   // win chance needed to break even (= cost)
}

export function expectedReturn(price: number, winProb: number, rate: number): ReturnResult | null {
  if (!ok(price, winProb, rate) || !(price > 0 && price < 1) || winProb < 0 || winProb > 1 || rate < 0) return null;
  const fee = feePerShare(price, rate);
  const cost = price + fee;
  const edge = winProb - cost;
  const roi_pct = (edge / cost) * 100;
  return { fee, cost, edge, roi_pct, profit_100: roi_pct, break_even: cost };
}

export interface Bet { stake: number; price: number; winProb: number; rate: number }
export interface MultiResult { stake: number; expected_profit: number; roi_pct: number; any_win: number; all_lose: number; valid: number }

/** Independent bets (not a parlay): calculated profits add up. */
export function multiBet(bets: Bet[]): MultiResult | null {
  let stake = 0, expected_profit = 0, all_lose = 1, valid = 0;
  for (const b of bets) {
    const r = expectedReturn(b.price, b.winProb, b.rate);
    if (!r || !ok(b.stake) || b.stake <= 0) continue;
    valid++;
    stake += b.stake;
    expected_profit += (b.stake * r.roi_pct) / 100;
    all_lose *= 1 - b.winProb;
  }
  if (!valid) return null;
  return { stake, expected_profit, roi_pct: (expected_profit / stake) * 100, any_win: 1 - all_lose, all_lose, valid };
}
