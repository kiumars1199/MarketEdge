// T-296: /track-record in plain words (docs/OVERHAUL.md §E, §G3). One headline per section, every figure read from
// backtest.json or ledger_summary.json, never typed in. Pure, so the page and the unit tests share it.
// Findings behind the wording: docs/research/live-vs-backtest.md.
import { exactCount, formatCount, pct, ret } from "@/lib/format";
import { liveBase, liveReturn, usEvents } from "@/lib/proof";
import type { BacktestRecord, LedgerSummary, PayoutStats } from "@/lib/types";
import type { WeekDir } from "@/lib/trackRecord";

/** Fewest bets a group needs before a section's headline uses it. */
export const MIN_BETS = 30;

export interface Headline { value: string; tone: "pos" | "neg" | "flat"; sentence: string }
const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const tone = (x: number | null | undefined): Headline["tone"] => (!ok(x) || x === 0 ? "flat" : x > 0 ? "pos" : "neg");
const bets = (n: number) => `${exactCount(n)} settled bet${n === 1 ? "" : "s"}`;
const evs = (n: number) => `${exactCount(n)} event${n === 1 ? "" : "s"}`;

/** Polymarket US record (the only venue US users can trade): settled US-listed bets at the US price and fee. */
export function usHeadline(l: LedgerSummary | null | undefined): Headline {
  const u = l?.us;
  if (!u?.graded) {
    return {
      value: "—", tone: "flat",
      sentence: u?.entries
        ? `${exactCount(u.entries)} best bet${u.entries === 1 ? "" : "s"} on Polymarket US logged at the US price, none settled yet.`
        : "No bets on Polymarket US logged yet. Every best bet listed there is logged at its US price and fee.",
    };
  }
  const r = liveReturn(u);
  return {
    value: ret(r), tone: tone(r),
    sentence: `Return on ${bets(u.graded)}${usEvents(l) !== null ? ` in ${evs(usEvents(l)!)}` : ""} you could place on Polymarket US, $1 a bet at the US price plus its fee.`,
  };
}

/** The whole live record (international prices), each bet counted once. */
export function liveHeadline(l: LedgerSummary | null | undefined, since: string | null): Headline {
  const s = liveBase(l);
  if (!s) return { value: "—", tone: "flat", sentence: "No live record on this data yet. It starts with the first logged best bet." };
  if (!s.graded) {
    return { value: "—", tone: "flat", sentence: `${formatCount(s.entries)} best bets logged${since ? ` since ${since}` : ""}, none settled yet.` };
  }
  const r = liveReturn(s);
  return {
    value: ret(r), tone: tone(r),
    sentence: `Return on ${bets(s.graded)} logged${since ? ` since ${since}` : ""}, $1 a bet at the real asking price plus the fee.`,
  };
}

/** "Including international-only bets US users couldn't place: N (mostly weather)." null when there are none. */
export function intlOnlyNote(l: LedgerSummary | null | undefined): string | null {
  const n = l?.intl_only?.graded;
  if (!l || !n || !l.us?.entries) return null;   // before US prices were logged every bet reads as international-only
  const top = Object.entries(l.by_category).sort((a, b) => b[1].graded - a[1].graded)[0];
  const mostly = top && top[1].graded * 2 > l.graded ? ` (mostly ${top[0]})` : "";
  return `Including international-only bets US users couldn't place: ${exactCount(n)}${mostly}.`;
}

/** The testing card: the chosen walk-forward taker record. */
export function testHeadline(r: BacktestRecord | null | undefined, span: string | null): Headline {
  if (!r?.flags) return { value: "—", tone: "flat", sentence: "No test has run on this data yet." };
  return {
    value: ret(r.roi_pct), tone: tone(r.roi_pct),
    sentence: `Return on ${formatCount(r.flags)} best bets on ${span ?? "past markets"}, each picked by a model that only knew earlier weeks.`,
  };
}

/** One sentence that puts live and test side by side, without judging more than the numbers allow. */
export function compareSentence(l: LedgerSummary | null | undefined, r: BacktestRecord | null | undefined): string | null {
  const live = liveReturn(liveBase(l));
  if (live === null || !r?.flags || !ok(r.roi_pct)) return null;
  if (Math.abs(r.roi_pct - live) < 1) return "So far live bets are doing about as well as testing.";
  return live < r.roi_pct
    ? `So far live bets are doing worse than testing (${ret(live)} vs ${ret(r.roi_pct)}). The live record is young: bets on one game or one day's weather win or lose together, so a few results move it a lot.`
    : `So far live bets are doing better than testing (${ret(live)} vs ${ret(r.roi_pct)}). The live record is young, so this can change quickly.`;
}

/** Week by week: "N of M weeks made money", plus how much of the test sits in its last two weeks. */
export function weeksHeadline(rows: { bets: number; dir: WeekDir }[]): { value: string; sentence: string; lastTwoShare: number | null } {
  const withBets = rows.filter((x) => x.bets > 0);
  const up = rows.filter((x) => x.dir === "up").length;
  const total = rows.reduce((s, x) => s + x.bets, 0);
  const lastTwo = rows.slice(-2).reduce((s, x) => s + x.bets, 0);
  const share = total ? lastTwo / total : null;
  const tail = share !== null && share >= 0.5 ? ` ${pct(share)} of all test bets come from the last two weeks.` : "";
  return {
    value: `${up} of ${withBets.length}`,
    sentence: `test weeks with best bets made money. Each bar is one week; red weeks lost money.${tail}`,
    lastTwoShare: share,
  };
}

/** "Bets we rated higher did better" only while the test says so: the actual result rises with the rating across
 *  every edge group of at least MIN_BETS bets (and there are at least two such groups). */
export function ratedHigher(rows: { bets: number; realized: number }[]): { holds: boolean; title: string; sentence: string } {
  const g = rows.filter((x) => x.bets >= MIN_BETS);
  const holds = g.length >= 2 && g.every((x, i) => i === 0 || x.realized >= g[i - 1].realized) && g.at(-1)!.realized > g[0].realized;
  return holds
    ? { holds, title: "Bets we rated higher did better", sentence: "In testing, each step up in our rating earned more per bet than the step below." }
    : { holds, title: "Did bets we rated higher do better?", sentence: "In testing, not consistently: a higher rating did not always earn more per bet." };
}

/** By category / by time before close: how many groups made money, and the biggest one. */
export function biggestGroup<T extends { name: string; r: BacktestRecord }>(rows: T[], what: string): Headline | null {
  const big = rows.filter((x) => (x.r.flags ?? 0) >= MIN_BETS);
  const top = [...big].sort((a, b) => (b.r.flags ?? 0) - (a.r.flags ?? 0))[0];
  if (!top) return null;
  const made = big.filter((x) => (x.r.roi_pct ?? 0) > 0).length;
  return {
    value: `${made} of ${big.length}`, tone: made === big.length ? "pos" : made === 0 ? "neg" : "flat",
    sentence: `${what} with at least ${MIN_BETS} test bets made money. The biggest, ${top.name}, returned ${ret(top.r.roi_pct)}.`,
  };
}

/** By payout: share of best bets that pay under 1.5x. */
export function paysHeadline(best: Record<string, BacktestRecord | undefined> | undefined): Headline | null {
  const all = Object.values(best ?? {}).reduce((s, x) => s + (x?.flags ?? 0), 0);
  const low = best?.["<1.5x"]?.flags ?? 0;
  if (!all) return null;
  return { value: pct(low / all), tone: "flat", sentence: "of best bets pay less than 1.5x: they win often and pay little, so one loss undoes several wins." };
}

/** Kismet's picks vs other bets at the same payout (ledger_summary.vs_same_payout): for every new pick the scanner
 *  logs one random other bet at the same payout band, graded the same way. The sample is the same-payout bets'
 *  events (they carry event ids). The picks' own event count is not shown: `picks` holds every pick since the ledger
 *  began, including rows logged before event ids, each counted as its own event. Judged on the same bar as the proof
 *  line (`needs`, eventsNeeded): under it the returns are shown but no difference is claimed. */
export interface PayoutRow { band: string; picks: PayoutStats; others: PayoutStats }
const BANDS = ["<1.5x", "1.5-2x", "2-3x", "3-5x", "5-10x", "10x+"];
export function samePayoutRows(l: LedgerSummary | null | undefined): PayoutRow[] {
  const v = l?.vs_same_payout ?? {};
  return BANDS.filter((b) => v[b]).map((b) => ({ band: b, ...v[b] }));
}
export function samePayoutHeadline(l: LedgerSummary | null | undefined, needs: number | null): Headline | null {
  const all = l?.vs_same_payout?.all;
  if (!all) return null;
  const p = all.picks, o = all.others;
  if (!o.graded || !p.graded) {
    return { value: "—", tone: "flat", sentence: o.entries
      ? `${exactCount(o.entries)} same-payout bet${o.entries === 1 ? "" : "s"} logged beside our picks, none settled yet.`
      : "Same-payout bets are logged beside each new pick; none yet." };
  }
  const both = `Our picks returned ${ret(p.roi_pct)}; random bets at the same payouts returned ${ret(o.roi_pct)} over ${evs(o.events)}.`;
  const d = ok(p.roi_pct) && ok(o.roi_pct) ? p.roi_pct - o.roi_pct : null;
  if (d === null || needs === null || o.events < needs) {
    const why = needs === null ? "" : ` Too few to judge yet (needs ~${formatCount(needs)} events).`;
    return { value: "—", tone: "flat", sentence: `${both}${why}` };
  }
  const a = Math.abs(d);
  const pts = `${d >= 0 ? "+" : "−"}${a >= 10 ? Math.round(a) : a.toFixed(1).replace(/\.0$/, "")} pts`;
  return { value: pts, tone: tone(d), sentence: `${both} The difference is our picks' return minus theirs.` };
}
