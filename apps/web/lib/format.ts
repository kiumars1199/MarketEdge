// Shared number formatting and plain-language labels (docs/06 § Display language). Every lane uses these;
// never format a user-facing number another way. Missing values render "—".
import type { Side } from "@/lib/types";

const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
export const DASH = "—";

/** 0.68 → "68%" (one decimal when not whole: 0.055 → "5.5%") */
export function price(p: number | null | undefined): string {
  if (!ok(p)) return DASH;
  // Q, Nov 20: no cents anywhere a user looks. A price reads as the market's chance: 0.68 → "68%", 0.004 → "0.4%".
  const c = p * 100;
  return `${Math.abs(c - Math.round(c)) < 0.05 ? Math.round(c) : c.toFixed(1)}%`;
}
/** A price as the multiplier bettors read (Q, Nov 20: "people know by multiplier, not by dollar or cent"):
 *  0.63 → "1.59x", 0.08 → "12.5x", 0.004 → "250x". What $1 returns if it wins, before the fee. */
export function odds(p: number | null | undefined): string {
  if (!ok(p) || p <= 0 || p >= 1) return DASH;
  const x = 1 / p;
  return `${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2)}x`;
}
/** A fee or other per-share cost as a share of what you pay: fee 0.011 on a 0.70 ask → "1.6%". */
export function costPct(cost: number | null | undefined, ask: number | null | undefined): string {
  if (!ok(cost) || !ok(ask) || ask <= 0) return DASH;
  const v = (cost / ask) * 100;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}%`;
}
/** A gap between two prices in percentage points: 0.05 → "5 points". */
export function points(d: number | null | undefined): string {
  if (!ok(d)) return DASH;
  const v = Math.abs(d) * 100;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${v === 1 ? "point" : "points"}`;
}
/** payout per $1 from the ask (docs/13 §3): 0.33 → "3.0x", 0.08 → "13x"; no ask → "—" */
export function pays(ask: number | null | undefined): string {
  if (!ok(ask) || ask <= 0) return DASH;
  const x = 1 / ask;
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}x`;
}
export const PAYS_HELP = "What $1 returns if this side wins: $1 ÷ price, before the fee.";
/** 0.79 → "79%" */
export function pct(p: number | null | undefined): string {
  return ok(p) ? `${Math.round(p * 100)}%` : DASH;
}
/** estimated return from roi_pct: 33.2 → "+33%", 4.6 → "+4.6%", -2 → "−2%" */
export function ret(roiPct: number | null | undefined): string {
  if (!ok(roiPct)) return DASH;
  const a = Math.abs(roiPct);
  const n = a >= 10 ? Math.round(a).toString() : a.toFixed(1).replace(/\.0$/, "");
  return `${roiPct < 0 ? "−" : "+"}${n}%`;
}
/** edge for Pro mode in percentage points: 0.051 → "+5.1 pts" */
export function edge(e: number | null | undefined): string {
  if (!ok(e)) return DASH;
  return `${e < 0 ? "−" : "+"}${Math.abs(e * 100).toFixed(1)} pts`;
}
/** Free tier (T-44): the API sends `ranges` instead of exact numbers. "+5–10%", "under 0%", "over +50%". */
type Band = [number | null, number | null];
const span = ([lo, hi]: Band, f: (x: number) => string, unit: string) =>
  lo === null ? `under ${f(hi ?? 0).replace(/^\+/, "")}` : hi === null ? `over ${f(lo)}` : `${f(lo).slice(0, -unit.length)}–${f(hi).replace(/^\+/, "")}`;
/** Estimated return for a side: exact, or its band on the Free tier. */
export function sideRet(s: Pick<Side, "roi_pct" | "ranges">): string {
  return s.ranges ? span(s.ranges.roi_pct, ret, "%") : ret(s.roi_pct);
}
/** Edge per share for a side: exact, or its band on the Free tier. */
export function sideEdge(s: Pick<Side, "edge" | "ranges">): string {
  return s.ranges ? span(s.ranges.edge, (e) => edge(e).replace(".0 pts", " pts"), " pts") : edge(s.edge);
}
/** "Past results: +$33 per $100 bet": exact, or its band on the Free tier ("+$5–$10"), so a band's low end never reads as exact. */
export function sideProfit(s: Pick<Side, "roi_pct" | "ranges">): string {
  if (!s.ranges) {
    const p = expectedProfit(s.roi_pct);
    return money(p === null ? null : Math.round(p), true);
  }
  const [lo, hi] = s.ranges.roi_pct;
  const f = (x: number) => money(x, true);
  return lo === null ? `under ${f(hi ?? 0).replace(/^\+/, "")}` : hi === null ? `over ${f(lo)}` : `${f(lo)}–${f(hi).replace(/^\+/, "")}`;
}
/** $1,234 (whole dollars ≥ $100, cents below) ; signed adds +/− */
export function money(usd: number | null | undefined, signed = false): string {
  if (!ok(usd)) return DASH;
  const a = Math.abs(usd);
  const s = a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2).replace(/\.00$/, "");
  return `${signed ? (usd < 0 ? "−" : "+") : usd < 0 ? "−" : ""}$${s}`;
}
/** A plan price as listed (pricing, terms): 12 → "$12", 169.99 → "$169.99". Never rounded, unlike money(). */
export const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
/** An ISO timestamp in UTC for the admin pages: "Nov 18, 2026, 3:04 PM UTC". */
export const utcWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
/** average profit on a stake from roi_pct (past results, not a promise) */
export function expectedProfit(roiPct: number | null | undefined, stake = 100): number | null {
  return ok(roiPct) ? (roiPct / 100) * stake : null;
}

export type Chance = "Leans your way" | "Coin flip" | "Long shot";
/** chance label from win_prob: ≥55% Leans your way, 40–55% Coin flip, <40% Long shot. docs/19 P4: no
 *  "Likely to hit" bucket, it read as a promise. */
export function chance(winProb: number | null | undefined): Chance | null {
  if (!ok(winProb)) return null;
  return winProb >= 0.55 ? "Leans your way" : winProb >= 0.4 ? "Coin flip" : "Long shot";
}

/** docs/19 P4: what a stake pays back if this side wins, after the fee: shares = stake / (price + fee), $1 each. */
export function payoutIfWins(stake: number | null | undefined, s: Pick<Side, "ask" | "fee">): number | null {
  const cost = s.ask + (ok(s.fee) ? s.fee : 0);
  return ok(stake) && stake > 0 && ok(s.ask) && cost > 0 && cost < 1 ? stake / cost : null;
}
/** "$13", "$1,330", "$4.50": whole dollars from $10, cents below. */
export const payoutMoney = (usd: number | null) => money(usd !== null && usd >= 10 ? Math.round(usd) : usd);

/** docs/19 P4: a neutral confidence label from the sample behind the estimate (effective past bets, model_neff).
 *  ponytail: one cutoff at 100 (fixture: min 40, Q1 87, median 272); tune here if the engine's sample sizes move. */
export type RecordLabel = "Strong record" | "Thin record";
export const STRONG_RECORD_NEFF = 100;
export function recordLabel(neff: number | null | undefined): RecordLabel | null {
  return ok(neff) ? (neff >= STRONG_RECORD_NEFF ? "Strong record" : "Thin record") : null;
}
export const recordHelp = (neff: number) =>
  `About ${formatCount(neff)} similar past bets (effective sample) behind this estimate. More past bets means a firmer estimate, not a surer win.`;
/** "Bet Yes · pays 1.47x" */
export function betLine(s: Pick<Side, "outcome" | "ask">): string {
  return `Bet ${s.outcome} · pays ${odds(s.ask)}`;
}
/** "similar past bets returned": realistic_edge / (ask + fee), as roi % */
export function realisticReturn(s: Pick<Side, "realistic_edge" | "ask" | "fee">): number | null {
  return ok(s.realistic_edge) && s.ask + s.fee > 0 ? (s.realistic_edge / (s.ask + s.fee)) * 100 : null;
}
/** closes in: unix seconds → "45m", "19h", "3 days"; past → "closed". T-288: one rounding rule everywhere times
 *  appear (cards, drawer, market page, tables, CSV, alerts, MCP), and it is DOWN, like the closing strip's countdown:
 *  2h 40m left reads "2h", never "3h", so the time left is never overstated. Under a minute reads "1m". */
export function closesIn(closesAt: number | null | undefined, now = Date.now()): string {
  if (!ok(closesAt)) return DASH;
  const m = (closesAt * 1000 - now) / 60000;
  if (m <= 0) return "closed";
  if (m < 60) return `${Math.max(1, Math.floor(m))}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)} days`;
}
/** "closes in 45m" for an open market, "Closed" once closes_at has passed: never "closes in closed". */
export function closesLine(closesAt: number | null | undefined, now = Date.now(), cap = false): string {
  if (ok(closesAt) && closesAt * 1000 <= now) return "Closed";
  return `${cap ? "Closes" : "closes"} in ${closesIn(closesAt, now)}`;
}
/** "12 min ago" from unix seconds */
export function ago(unixSec: number | null | undefined, now = Date.now()): string {
  if (!ok(unixSec)) return DASH;
  const m = Math.max(0, (now - unixSec * 1000) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  return h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}
/** "Price as of 12s ago" from a ms timestamp (live re-pricing, lib/reprice.ts) */
export function priceAsOf(atMs: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - atMs) / 1000));
  return `Price as of ${sec < 60 ? `${sec}s ago` : ago(atMs / 1000, now)}`;
}
/** tooltip text explaining estimated return (show once per page) */
export const RETURN_HELP =
  "If you made this kind of bet many times, this is the average profit per dollar, based on how similar past bets resolved. Any single bet can lose.";
/** model basis tooltip: "Model: NFL · totals · ~24 h · 812 eff. samples · 190 events" */
export function basis(m: { niche: string; market_type: string; horizon_h: number }, s: Pick<Side, "model_neff" | "model_events" | "model_level">): string {
  const lvl = { all: "all markets", cat: "category", niche: "niche", nmt: "niche + type" }[s.model_level] ?? s.model_level;
  return `Model: ${m.niche.toUpperCase()} · ${m.market_type} · ~${m.horizon_h} h · ${formatCount(s.model_neff)} eff. samples · ${formatCount(s.model_events)} events (${lvl} level)`;
}

/** docs/18 §4: counts of bets, markets, events. Under 10,000 exact with a comma (QA-A, Marc #6: "8.3K bets" read as
 *  vague next to an exact 8,323 elsewhere); above, ROUNDED DOWN to one decimal so a count is never overstated, with a
 *  trailing ".0" dropped: 999 → "999", 1,050 → "1,050", 9,666 → "9,666", 10,000 → "10K", 16,896 → "16.8K",
 *  778,152 → "778.1K", 1,000,000 → "1M", 1,234,567 → "1.2M". The exact number goes in the hover
 *  (<Count> in components/kit does both). */
export function formatCount(n: number | null | undefined): string {
  if (!ok(n)) return DASH;
  const a = Math.floor(Math.abs(n));
  const sign = n < 0 ? "−" : "";
  if (a < 10_000) return `${sign}${a.toLocaleString("en-US")}`;
  const [d, u] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const tenths = Math.floor(a / (d / 10));   // integer math: no 2.3 * 10 = 22.999… surprises
  return `${sign}${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ""}${u}`;
}
/** "1 bet", "2 bets", "12.3K bets": a count with its noun in the right number (QA-A, Marc #6). `many` defaults to one + "s". */
export const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${Math.abs(n) === 1 ? one : many}`;
/** exact count for the hover: 9666 → "9,666" */
export const exactCount = (n: number | null | undefined) => (ok(n) ? Math.round(n).toLocaleString("en-US") : DASH);

/** docs/18 §6 / docs/19 P4 "wins about 1 in 7", "wins about 8–9 in 10". Under 35% as 1 in N (N = 1 ÷ p, rounded);
 *  from 35% in tenths: within a quarter of a whole tenth it's that tenth, else the two tenths around it (85% →
 *  "8–9 in 10", never a rounded-up "9"). From 92.5% "over 9 in 10", so it never reads as certain. */
export function winsAbout(p: number | null | undefined): string {
  if (!ok(p) || p <= 0) return DASH;
  if (p < 0.35) return `1 in ${Math.round(1 / p)}`;
  if (p >= 0.925) return "over 9 in 10";
  const t = Math.round(p * 1000) / 100;   // tenths, clean of float noise (0.85 * 10 = 8.5 exactly, 0.7 * 10 = 7.000…01)
  const lo = Math.floor(t), f = t - lo;
  if (f <= 0.25) return `${lo} in 10`;
  if (f >= 0.75) return `${lo + 1} in 10`;
  return `${lo}–${lo + 1} in 10`;
}
/** How a payout band (or combo size) did in the walk-forward test, docs/18 §2. Losing records always say
 *  "lost money in testing": labelled, never hidden. Null when nothing was tested. */
export function testedLine(r: { flags?: number; combos?: number; win_rate?: number; roi_pct?: number } | null | undefined, who = "Bets like this"): string | null {
  const n = r?.flags ?? r?.combos;
  if (!r || !n || !ok(r.roi_pct)) return null;
  const won = ok(r.win_rate) ? `won ${pct(r.win_rate)} of the time, ` : "";
  return `${who}: ${won}${r.roi_pct < 0 ? `lost money in testing (${ret(r.roi_pct)})` : `${ret(r.roi_pct)} return in testing`}`;
}
/** Under 25% chance the drawer says plainly what usually happens (docs/18 §6). */
export const LONG_SHOT_LINE = "Most of the time this loses. The edge means you're getting a better price than usual, not that it will hit.";

/** The estimated return every surface shows (card, "Why this bet?", drawer, table, landing): the one that follows from
 *  the win chance printed next to it (win chance × payout − stake, after the fee), so the numbers on a screen multiply
 *  out. #55/#20 (Mark, Nov 20): cards used to show what similar past bets returned instead, which disagreed with the
 *  win chance beside it and with the table (+28% vs +47%). That figure now has its own labelled line (pastReturnLine).
 *  Free-tier bands pass through unchanged. `realistic` stays in the shape for older callers and is always false. */
export function cardReturn(s: Pick<Side, "roi_pct" | "ranges" | "realistic_edge" | "ask" | "fee">): { roi: number | null; text: string; profit: string; realistic: boolean } {
  return { roi: ok(s.roi_pct) ? s.roi_pct : null, text: sideRet(s), profit: sideProfit(s), realistic: false };
}
/** "Similar past bets returned +28% on average", or null when unknown or on a Free band. Shown as its own line under the
 *  estimate, never in its place (#20: each figure says what it is). */
export function pastReturnLine(s: Pick<Side, "realistic_edge" | "ask" | "fee" | "ranges">): string | null {
  const real = s.ranges ? null : realisticReturn(s);
  return real === null ? null : `${ret(real)} on average`;
}
export const ESTIMATE_HELP = "Win chance × payout, minus the stake, at today's price after the fee. Per bet, on average; any single bet can lose.";
export const PAST_RETURN_HELP =
  "What past bets with a similar estimate actually returned, after the fee and the price you'd really pay. It is usually lower than the estimate above, because big estimates tend to run high.";

/** Game or close time, docs/17 fix 14: "Tue 2:45 PM" within the next 6 days, else "Nov 28". In `timeZone` (the
 *  user's, components/clock.tsx), local when undefined. A narrow no-break space before AM/PM (newer ICU, Node or
 *  browser) becomes a plain space, so the server and the browser print the same bytes. */
export function gameTime(closesAt: number | null | undefined, now = Date.now(), timeZone?: string): string {
  if (!ok(closesAt)) return DASH;
  const d = new Date(closesAt * 1000);
  return (closesAt * 1000 - now < 6 * 86400_000
    ? d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }).replace(",", "")
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone })).replace(/[\u202f\u00a0]/g, " ");
}

/** Live countdown for the closing-soon strip: "2h 05m", "14m", "closing". */
export function countdown(closesAt: number, now = Date.now()): string {
  const m = Math.floor((closesAt * 1000 - now) / 60000);
  if (m <= 0) return "closing";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The Free delay in words (owner, Nov 18): 0 → "live", 1 → "at least 1 minute", N → "at least N minutes". */
export const delayWords = (min: number) => (min <= 0 ? "live" : `at least ${min} minute${min === 1 ? "" : "s"}`);
/** "live", or "at least N minutes behind". */
export const behindWords = (min: number) => (min <= 0 ? "live" : `${delayWords(min)} behind`);
