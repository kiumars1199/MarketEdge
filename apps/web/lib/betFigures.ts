// T-289: every figure and label a bet shows, in one place. BetCard, MarketCard, the drawer headline, the /about preview
// card, the screener table, My list, CSV and the MCP text all read from here, so a card can't say one number while the
// drawer says another, and a label can't contradict its number (outside tester, Nov 20).
// QA-B (Marc, Nov 20, #55/#31/#20/#37/#54/#5): one payout and one return per bet. Both come from betQuote, at the
// price the card shows (the US price on a US card): payout = 1 ÷ (price + fee), return = win chance × payout − 1.
import { cardVenue, dollars, multX, STAKE, stars, type CardVenue, type Stars } from "@/lib/card";
import { chance, costPct, money, pct, recordLabel, ret, sideRet, winsAbout, type Chance, type RecordLabel } from "@/lib/format";
import type { Market, Side } from "@/lib/types";

const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

type S = Pick<Side, "ask" | "fee" | "edge" | "win_prob" | "ranges">;

/** Is the edge after the fee above zero? Free sides carry a band (numeric `edge` is only its low end), so the band
 *  decides: "under 0" is not positive, "0–2 pts" and up are. */
export function edgeAbove0(s: Pick<Side, "edge" | "ranges">): boolean {
  return s.ranges ? s.ranges.edge[0] !== null : ok(s.edge) && s.edge > 0;
}

/** The gap in points of win chance: how often bets like this won minus the price (before the fee), [lo, hi] in
 *  probability. Exact sides: one number. Free sides only have win_prob floored to 5% and the edge band, so the gap is
 *  where both say it is: [floor, floor + 5%) ∩ [edge band + fee]. Built only from fields Free already receives. */
export function gapRange(s: S): [number, number] | null {
  if (!ok(s.ask) || !ok(s.win_prob)) return null;
  if (!s.ranges) return [s.win_prob - s.ask, s.win_prob - s.ask];
  const fee = ok(s.fee) ? s.fee : 0;
  const [elo, ehi] = s.ranges.edge;
  const lo = Math.max(s.win_prob - s.ask, elo === null ? -Infinity : elo + fee);
  const hi = Math.min(s.win_prob + 0.05 - s.ask, ehi === null ? Infinity : ehi + fee);
  // #5 (Marc): when the two don't overlap (rounding at a band edge), say the floored gap, never a band it isn't in
  return lo <= hi ? [lo, hi] : [s.win_prob - s.ask, s.win_prob - s.ask];
}

const signed = (p: number) => `${p < 0 ? "−" : p === 0 ? "" : "+"}${Math.abs(p)}`;
/** "+13 pts", "+1 pt", "0 pts", "−2 pts", Free "+5–9 pts". Whole points; a band whose ends round alike is one number. */
export function gapPts(s: S): string {
  const g = gapRange(s);
  if (!g) return "—";
  // whole points, except a gap under 1 point keeps one decimal so a positive gap never prints as "0 pts" (#5)
  const pts = (x: number) => (Math.abs(x) >= 0.01 || x === 0 ? Math.round(x * 100) : Math.abs(x) >= 0.001 ? Math.round(x * 1000) / 10 : Math.round(x * 10000) / 100);
  const [a, b] = g.map((x) => pts(x) + 0) as [number, number];
  if (a === b) return `${signed(a)} ${Math.abs(a) === 1 ? "pt" : "pts"}`;
  return a < 0 && b > 0 ? `${signed(a)} to ${signed(b)} pts` : `${signed(a)}–${Math.abs(b)} pts`;
}

/** Hover for the points: what they measure, and that the fee comes out of them. */
export const PTS_HELP =
  "Points of win chance: how often bets like this have won, minus the price. A 70% price implies 70%; if bets like it won 80%, that's +10 pts. The fee comes out of this gap.";

export type VerdictTone = "up" | "thin" | "down";
/** The price verdict, from the same quantities as the points beside it: the gap (pts) and the edge after the fee. */
export function verdict(s: S): { text: string; tone: VerdictTone } {
  if (edgeAbove0(s)) return { text: "Better price than usual", tone: "up" };
  const g = gapRange(s);
  if (g && g[1] > 0) return { text: "Won more often than the price, not by enough to cover the fee", tone: "thin" };
  return { text: "Priced above how often bets like it won", tone: "down" };
}

/** Chance label (docs/06 bands) only when the edge is above zero: "Leans your way" on a bet priced too high misleads. */
export function sideChance(s: Pick<Side, "edge" | "ranges" | "win_prob">): Chance | null {
  return edgeAbove0(s) ? chance(s.win_prob) : null;
}
/** Sample-size label; "Strong record" only on a bet whose edge is above zero ("Thin record" is a caution and stays). */
export function sideRecord(s: Pick<Side, "edge" | "ranges" | "model_neff">): RecordLabel | null {
  const r = recordLabel(s.model_neff);
  return r === "Strong record" && !edgeAbove0(s) ? null : r;
}

/** The one return a bet shows: card, drawer, table, MCP. The estimated return after the fee at the price the card
 *  shows = win chance × payout − 1. Free sees its band. */
export const RETURN_LABEL = "Estimated return";   // never "expected" (docs/01 Compliance, test/profit-claim.ts)
export const RETURN_LABEL_LONG = "estimated return at today's price";
export const RETURN_HELP_ONE =
  "Our win chance × the payout after the fee, minus the $1 you put in, at today's price: what a $1 bet like this returns on average if our win chance is right. Any single bet can lose.";
/** Hover for a "pays" figure: the one payout, after the fee. */
export const PAYS_AFTER_FEE_HELP = "What $1 brings back if this side wins, after the fee: $1 ÷ (price + fee). The same figure as the card and the stake box.";
/** The FAQ entry that explains why this differs from "how bets like this did in testing" and the live record. */
export const RETURNS_FAQ = "/about#returns";

// Free's cuts (lib/data/gate.ts ROI and EDGE; not imported: gate.ts is server code). A Free US quote carries only the
// band's low end (usBanded), so its band is rebuilt from that.
const ROI_CUTS = [0, 5, 10, 20, 50];
const EDGE_CUTS = [0, 0.02, 0.05, 0.1, 0.2];
function bandOf(x: number, cuts: number[]): [number | null, number | null] {
  if (!Number.isFinite(x) || x < cuts[0]!) return [null, cuts[0]!];
  let i = cuts.length - 1;
  while (x < cuts[i]!) i--;
  return [cuts[i]!, cuts[i + 1] ?? null];
}

export interface BetQuote {
  venue: CardVenue["kind"];
  ask: number | null;      // the price the card shows (the US price on a US card)
  fee: number | null;
  winProb: number;
  /** Payout per $1 if it wins, after the fee: 1 ÷ (price + fee). The ONE payout figure (card, drawer, table, stake
   *  box); a number so a sort can use exactly what the card shows (#69). */
  pays: number | null;
  paysText: string | null; // "1.39x"
  roi: number | null;      // % at this price; Free: its band's low end
  retText: string;         // "+25%", Free "+20–50%"
  banded: boolean;
  /** "90% × 1.39x − 1 ≈ +25%": the return's arithmetic. Exact numbers only, never on a Free band. */
  math: string | null;
  edge: number | null;     // win chance − price − fee at this price; Free: band low end
}

const pctFine = (p: number) => `${(Math.round(p * 1000) / 10).toFixed(1).replace(/\.0$/, "")}%`;

/** Everything a bet's payout and return come from, at the price its card shows: the US price on a US card
 *  (lib/card cardVenue), else the international price, or `opts.ask` (a live international price, exact tiers only). */
/** #5 (Marc, Nov 20): the value label comes from the quote's own return, so a label never disagrees with the figure
 *  beside it: an exact return of 0 or below gets no stars (stars() alone gives 0% one star). A Free band whose low end
 *  is 0 is 0–5%, so it keeps its star. */
export function quoteStars(q: Pick<BetQuote, "roi" | "banded">, neff: number | null | undefined): Stars | null {
  if (!ok(q.roi) || (!q.banded && q.roi <= 0)) return null;
  return stars({ roi_pct: q.roi, model_neff: neff });
}

export function betQuote(m: Pick<Market, "us" | "best"> | null | undefined, s: Side, opts: { ask?: number; fee?: number } = {}): BetQuote {
  const v = m ? cardVenue(m, s) : { kind: "intl" as const, ask: s.ask, fee: s.fee, roi_pct: s.roi_pct };
  const banded = !!s.ranges;
  let ask = v.ask, fee = v.fee, roi = v.roi_pct;
  let edgeV: number | null = v.kind === "us" ? (m?.us?.edge ?? null) : s.edge;
  if (v.kind !== "us" && !banded && ok(opts.ask) && (opts.ask !== s.ask || (ok(opts.fee) && opts.fee !== s.fee))) {
    ask = opts.ask;
    fee = ok(opts.fee) ? opts.fee : s.fee;
    roi = ask + fee > 0 ? (s.win_prob / (ask + fee) - 1) * 100 : null;
    edgeV = s.win_prob - ask - fee;
  }
  const cost = ok(ask) ? ask + (ok(fee) ? fee : 0) : null;
  const paysN = cost !== null && cost > 0 && cost < 1 ? 1 / cost : null;
  const band = !banded || !ok(roi) ? null : v.kind === "us" ? bandOf(roi, ROI_CUTS) : s.ranges!.roi_pct;
  const retText = !ok(roi) ? "—" : band ? sideRet({ roi_pct: roi, ranges: { roi_pct: band, edge: [null, null] } }) : ret(roi);
  const math = !banded && ok(roi) && paysN !== null ? `${pctFine(s.win_prob)} × ${paysN.toFixed(2)}x − 1 ≈ ${ret(roi)}` : null;
  return {
    venue: v.kind, ask, fee, winProb: s.win_prob, pays: paysN, paysText: paysN === null ? null : multX(paysN),
    roi: ok(roi) ? roi : null, retText, banded, math, edge: ok(edgeV) ? edgeV : null,
  };
}

/** The side as seen at the quote's price, so labels (points, verdict, chance, record) come from the same numbers as
 *  the payout and return beside them (#5). A Free side keeps its bands, rebuilt for the US price on a US card. */
export function atQuote(s: Side, q: BetQuote): Side {
  if (q.ask === s.ask && q.fee === s.fee && q.venue !== "us") return s;
  const ask = ok(q.ask) ? q.ask : s.ask, fee = ok(q.fee) ? q.fee : s.fee;
  const edgeV = ok(q.edge) ? q.edge : s.win_prob - ask - fee;
  const out: Side = { ...s, ask, fee, edge: edgeV, roi_pct: ok(q.roi) ? q.roi : s.roi_pct };
  if (s.ranges && q.venue === "us") out.ranges = { roi_pct: ok(q.roi) ? bandOf(q.roi, ROI_CUTS) : s.ranges.roi_pct, edge: bandOf(edgeV, EDGE_CUTS) };
  return out;
}

export interface BetFigures {
  quote: BetQuote;
  ask: number;
  pays: string;            // "1.39x", after the fee: the card's figure
  wins: string;            // "8–9 in 10"
  winPct: string;          // "85%"
  pts: string;             // "+13 pts"
  verdict: { text: string; tone: VerdictTone };
  chance: Chance | null;
  record: RecordLabel | null;
  ret: { roi: number | null; text: string; realistic: boolean };
  stake: number;
  stakeText: string;       // "$10"
  payout: number | null;   // stake × pays
  payoutText: string;      // "$13.89"
  /** "Pays 1.39x after the fee · Bet $10 → get $13.89 back if it wins" */
  feeLine: string;
  feeHelp: string;
}

/** Every figure for one side at the price its card shows (`market`: the US price on a US card; `ask`/`fee`: a live
 *  international price) and a stake (default the cards' $10, lib/card STAKE). */
export function betFigures(s: Side, opts: { market?: Pick<Market, "us" | "best"> | null; ask?: number; fee?: number; stake?: number } = {}): BetFigures {
  const q = betQuote(opts.market, s, { ask: opts.ask, fee: opts.fee });
  const at = atQuote(s, q);
  const ask = ok(q.ask) ? q.ask : s.ask;
  const stake = ok(opts.stake) && opts.stake > 0 ? opts.stake : STAKE;
  const payout = q.pays === null ? null : stake * q.pays;
  const payoutText = payout === null ? "—" : dollars(payout);
  const where = q.venue === "us" ? "Polymarket US's" : "Polymarket's";
  const feeHelp = `${q.paysText ?? "—"} is the payout after the fee: $1 ÷ (price ${pct(ask)} + fee). ${where} fee here is ${costPct(q.fee, ask)} of the price, so ${money(stake)} buys ${payout === null ? "—" : payout.toFixed(1)} shares; each pays $1 if it wins. If it loses, you lose the stake.`;
  return {
    quote: q,
    ask,
    pays: q.paysText ?? "—",
    wins: winsAbout(s.win_prob),
    winPct: pct(s.win_prob),
    pts: gapPts(at),
    verdict: verdict(at),
    chance: sideChance(at),
    record: sideRecord(at),
    ret: { roi: q.roi, text: q.retText, realistic: false },
    stake,
    stakeText: money(stake),
    payout,
    payoutText,
    feeLine: `Pays ${q.paysText ?? "—"} after the fee · Bet ${money(stake)} → get ${payoutText} back if it wins`,
    feeHelp,
  };
}
