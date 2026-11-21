// T-290 (outside tester, Nov 20): wherever the backtest return appears, the live record sits next to it, in one line,
// with every figure computed from backtest.json and ledger_summary.json (never typed in). Pure: server pages, the
// drawer, the MCP text and llms.txt all call proofLine, so they can't drift apart.
// T-296 (OVERHAUL §G3, docs/research/live-vs-backtest.md): the test span comes from the weeks that actually had best
// bets (folds[]), not folds × days ("1 year" when 87% of bets sat in the last 2 weeks); the live record counts each
// bet once (`first`); and "enough to compare" is judged on settled events, counted only where the ledger records
// them reliably (the Polymarket US record: rows logged before it have no event id).
import { exactCount, formatCount, pct, ret } from "@/lib/format";
import { chosenResult } from "@/lib/data/model";
import type { BacktestFile, BacktestRecord, LedgerStats, LedgerSummary } from "@/lib/types";

const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** backtest.json's top-level run fields (typed loosely in BacktestFile). */
type Span = { [k: string]: unknown };

/** The t-statistic a result needs before we call it different from zero; the same bar Results uses (paysRead). */
export const JUDGE_T = 2;
/** Fewest test events behind a threshold; under this the test itself is too thin to say what "enough" means. */
const MIN_TEST = 30;

/**
 * Settled live EVENTS needed to tell a return the size of the test's from zero.
 *
 * A mean return μ over n independent units has t = μ ÷ (σ / √n), so t grows with √n. Bets on one game or one day's
 * weather win or lose together, so the independent unit is the event (the test's t-stat is event-clustered too).
 * The test reached t_test over e_test events; keeping μ and σ, the events that reach t = JUDGE_T are
 *     e = e_test × (JUDGE_T ÷ t_test)²
 * e.g. 1,394 test events at t = 18.5 → 17 events. Rounded up. null when the test made no money, has no t-stat or
 * has under MIN_TEST events: then there is no positive result for the live record to confirm.
 */
export function eventsNeeded(r: Pick<BacktestRecord, "events" | "roi_pct" | "t_stat"> | null | undefined): number | null {
  if (!r || !ok(r.events) || r.events < MIN_TEST || !ok(r.roi_pct) || r.roi_pct <= 0 || !ok(r.t_stat) || r.t_stat <= 0) return null;
  return Math.max(1, Math.ceil(r.events * (JUDGE_T / r.t_stat) ** 2));
}

/**
 * Live return in % of money staked, the same definition as the backtest's roi_pct (total profit ÷ total cost).
 * The grader logs one $1 share per best bet with pnl = (won ? 1 : 0) − ask − fee (engine/ledger.py), so over the
 * settled bets Σcost = wins − Σpnl, and Σpnl = avg_pnl × graded. null with nothing settled.
 */
export function liveReturn(l: Pick<LedgerStats, "graded" | "wins" | "avg_pnl"> | null | undefined): number | null {
  if (!l || !l.graded || !ok(l.avg_pnl)) return null;
  const pnl = l.avg_pnl * l.graded;
  const cost = l.wins - pnl;
  return cost > 0 ? (pnl / cost) * 100 : null;
}

/** The live record counted the honest way: each bet once (`first`, re-flags at a lower price dropped) when the
 *  summary has it, else the raw rows (summaries written before `first` existed). */
export const liveBase = (l: LedgerSummary | null | undefined): LedgerStats | null => (l ? (l.first ?? l) : null);

/** Settled events the ledger counts reliably: the US record's only. engine/ledger.summarize groups by `event_id`,
 *  which rows logged before the US venue shipped don't have, so elsewhere each old market counts as its own event
 *  (Nov 20: 739 "events" for 742 bets, really ~208 games and city-days), and stays inflated as new rows arrive. */
export function usEvents(l: LedgerSummary | null | undefined): number | null {
  const u = l?.us;
  return u?.graded && ok(u.events) ? u.events : null;
}

const DAY = { month: "short", day: "numeric", timeZone: "UTC" } as const;
/** "Nov 17" (UTC, so server and browser agree). */
export const sinceDay = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", DAY);

/** Where the test's bets really fall: the first and last week that had any, and the share in the last two weeks. */
export interface TestWeeks { first: number | null; last: number | null; weeks: number; withBets: number; total: number; lastTwoShare: number | null }
export function testWeeks(b: Span | null | undefined): TestWeeks {
  const r = b && (b as BacktestFile).results ? chosenResult(b as BacktestFile) : undefined;
  const folds = (r?.folds ?? []) as (BacktestRecord & { start: number })[];
  const days = ok(b?.test_days) ? (b!.test_days as number) : 7;
  const has = folds.filter((f) => (f.flags ?? 0) > 0);
  const total = folds.reduce((s, f) => s + (f.flags ?? 0), 0);
  const lastTwo = folds.slice(-2).reduce((s, f) => s + (f.flags ?? 0), 0);
  return {
    first: has.length ? has[0].start : null,
    last: has.length ? has.at(-1)!.start + days * 86400 - 1 : null,
    weeks: folds.length, withBets: has.length, total,
    lastTwoShare: total ? lastTwo / total : null,
  };
}

/** The test's real span in words, with how many of its weeks had bets and how concentrated they are (Marc #36/#35:
 *  never "52 weeks" alone): "past markets from Aug 29 to Nov 14 (bets in 6 of 52 weeks, 95% in the last 2)" (years
 *  named when it crosses New Year). null when no week had a best bet. */
export function testSpan(b: Span | null | undefined): string | null {
  const w = testWeeks(b);
  if (w.first === null || w.last === null) return null;
  const y = (t: number) => new Date(t * 1000).getUTCFullYear();
  const day = (t: number) => (y(w.first!) === y(w.last!) ? sinceDay(t) : `${sinceDay(t)}, ${y(t)}`);
  const two = w.lastTwoShare !== null && w.weeks > 2 ? `, ${pct(w.lastTwoShare)} in the last 2` : "";
  return `past markets from ${day(w.first)} to ${day(w.last)} (bets in ${w.withBets} of ${w.weeks} weeks${two})`;
}

export interface Proof {
  test: string | null;      // "In testing on past markets from Aug 29 to Nov 14 (bets in 8 of 52 weeks, 95% in the last 2): +9.5% per bet."
  live: string;             // "Live since Nov 17: 593 settled bets, −0.7%; on Polymarket US 40 settled bets in 9 events, …"
  line: string;             // both, one sentence each
  help: string;             // the basis, for the hover
  needs: number | null;     // settled events needed (eventsNeeded)
  settled: number;
  liveRoi: number | null;
  enough: boolean;
}

/** #3 (Mark, Nov 20): the test and live numbers sat side by side with no reason given for the gap. When the win chances
 *  shown live ran above how often those bets actually won (by 3+ points, 50+ settled bets), say so in one sentence:
 *  that is what pulls a live return under a test return. */
export function calibration(l: Pick<LedgerStats, "graded" | "wins" | "avg_win_prob"> | null | undefined): string | null {
  if (!l || !ok(l.avg_win_prob) || !l.graded || l.graded < 50) return null;
  const won = l.wins / l.graded;
  if (l.avg_win_prob - won < 0.03) return null;
  return ` Why live trails testing: our win chances have run high, bets we gave ${Math.round(l.avg_win_prob * 100)}% won ${Math.round(won * 100)}% of the time.`;
}

/**
 * The proof line: test result, then the live record beside it.
 * `record` is the test result being shown (overall taker, or a category's); `live` the matching ledger totals
 * (each bet once where available); `us` the Polymarket US record, whose events decide "enough to compare" (no US
 * settlements → no call); `since` the first logged best bet (unix s); `who` names the group.
 */
export function proofLine(o: {
  record: BacktestRecord | null | undefined;
  backtest: Span | null | undefined;
  live: LedgerStats | null | undefined;
  us?: LedgerStats | null;
  since: number | null | undefined;
  updatedAt?: number | null;
  who?: string;
}): Proof {
  const span = testSpan(o.backtest);
  const r = o.record;
  const who = o.who ? `${o.who}, ` : "";
  const test = r && ok(r.roi_pct) && r.flags
    ? `${span ? `In testing on ${span}` : "In testing"}: ${who}${ret(r.roi_pct)} per bet${r.roi_pct < 0 ? " (lost money)" : ""}.`
    : null;
  const needs = eventsNeeded(r);
  const l = o.live;
  const settled = l?.graded ?? 0;
  const roi = liveReturn(l);
  const u = o.us?.graded && ok(o.us.events) ? o.us : null;
  const events = u ? (u.events as number) : null;
  const enough = needs !== null && events !== null && events >= needs;
  const head = o.since ? `Live since ${sinceDay(o.since)}` : "Live so far";
  const bets = (n: number) => `${exactCount(n)} settled bet${n === 1 ? "" : "s"}`;
  const evs = (n: number) => `${exactCount(n)} event${n === 1 ? "" : "s"}`;
  let live: string;
  if (!l) live = "Live record: starts with the first logged best bet.";
  else if (!settled) live = `${head}: ${exactCount(l.entries)} logged, none settled yet${needs ? ` (needs ~${formatCount(needs)} settled events to judge)` : ""}.`;
  else {
    const what = `${head}: ${bets(settled)}, ${ret(roi)}${u ? `; on Polymarket US ${bets(u.graded)} in ${evs(events!)}, ${ret(liveReturn(u))}` : ""}`;
    live = needs === null || events === null ? `${what}.`
      : enough ? `${what}, enough to compare with testing.`
        : `${what}, still too few to judge (needs ~${formatCount(needs)} events).`;
    live += calibration(l) ?? "";
  }

  const help = [
    r && r.flags ? `Testing: ${exactCount(r.flags)} past best bets${ok(r.events) ? ` in ${exactCount(r.events)} events` : ""}, each judged by a model fitted only on what came before; return = total profit ÷ total staked, after the fee.` : null,
    "Live: every best bet is logged when it is shown and graded when its market settles; return = total profit ÷ total staked, one $1 share per bet at the asking price plus the fee, each bet counted once.",
    needs !== null && r ? `"Needs ~${formatCount(needs)} events": settled games or weather days it takes for a return the size of the test's to stand out from zero (t ≈ ${JUDGE_T}): ${exactCount(r.events as number)} test events × (${JUDGE_T} ÷ t-stat ${(r.t_stat as number).toFixed(1)})². Events are counted on the Polymarket US record, the only one that records them.` : null,
    l && o.updatedAt ? `Updated ${sinceDay(o.updatedAt)}.` : null,
  ].filter(Boolean).join(" ");
  return { test, live, line: [test, live].filter(Boolean).join(" "), help, needs, settled, liveRoi: roi, enough };
}

/** The site-wide line: the chosen backtest result's taker record beside the live record (each bet once) and the
 *  Polymarket US record. */
export function siteProof(o: { backtest: BacktestFile | null | undefined; ledger: LedgerSummary | null | undefined; since: number | null | undefined }): Proof {
  return proofLine({
    record: o.backtest ? chosenResult(o.backtest)?.taker : null,
    backtest: o.backtest, live: liveBase(o.ledger), us: o.ledger?.us ?? null, since: o.since, updatedAt: o.ledger?.updated_at, who: "best bets",
  });
}

/** T-290: test records with no live counterpart (payout bands, lower-confidence bets, combos) say so instead of
 *  borrowing the best-bets live record, which would mislead: the ledger logs single best bets only. */
export const noLiveRecord = (group: string) => `No live record for ${group} yet: the live record tracks single best bets only.`;
/** The payout-band notes: the ledger is not split by payout, so its one line lives on Results, not beside each band. */
export const LIVE_NOT_BY_BAND = "No live record by payout band yet: the live record covers best bets as a whole.";

/** T-290 / Marc #4 (Nov 20): hit rate is not profit. The one answer to "do best bets win / can I lose", used by every
 *  FAQ. It must agree with a live record that wins most bets and still loses money, so it says both. */
export const HIT_RATE_VS_PROFIT =
  "Most do, because most best bets pay less than 1.5x. But winning often isn't profit: at those payouts one loss undoes several wins, so a record can win most of its bets and still lose money. Judge them by the return, which Results shows with how many bets it covers. Any single bet can lose.";

/** The live facts behind HIT_RATE_VS_PROFIT: "Live so far: 78% of 1,155 settled best bets won, and together they
 *  returned −1.3%." null with nothing settled. */
export function hitRateLive(l: LedgerSummary | null | undefined): string | null {
  const b = liveBase(l);
  if (!b || !b.graded) return null;
  return `Live so far: ${pct(b.wins / b.graded)} of ${exactCount(b.graded)} settled best bet${b.graded === 1 ? "" : "s"} won, and together they returned ${ret(liveReturn(b))}.`;
}

/** FAQ items with the live facts appended to the hit-rate answer, so "most win" and "lost money" sit in one answer. */
export function withLiveHitRate<T extends { a: unknown }>(items: T[], live: string | null): T[] {
  return live ? items.map((x) => (x.a === HIT_RATE_VS_PROFIT ? { ...x, a: `${HIT_RATE_VS_PROFIT} ${live}` } : x)) : items;
}

/** Marc #48: the bets are the same for everyone (no personal picks, CLAUDE.md rule 4), but the numbers are not: Free
 *  sees ranges, fewer bets and a delay. Every "is this advice?" answer uses this. */
export const SAME_FOR_EVERYONE =
  "The bets are picked the same way for everyone, never from your own bets. Free shows fewer of them, a little later, with ranges instead of exact figures.";
