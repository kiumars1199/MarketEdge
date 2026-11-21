// Results page (T-26, F-14) helpers. Pure: every figure comes straight from backtest.json (chosen half-life)
// and is formatted with lib/format. Nothing is recomputed, so the page always equals the file.
import { chosenResult } from "@/lib/data/model";
import { edge, formatCount, ret } from "@/lib/format";
import type { BacktestFile, BacktestRecord } from "@/lib/types";

interface Fold extends BacktestRecord { start: number }
interface EdgeBucket { predicted_lo: number; predicted_hi: number; flags: number; predicted_edge: number; realized_edge: number }

const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const int = (x: number | undefined) => (ok(x) ? formatCount(x) : "—");   // docs/18 §4; exact on hover in the UI
const tstat = (x: number | undefined) => (ok(x) ? x.toFixed(1) : "—");
const cents = (r: BacktestRecord) => (ok(r.pnl_cents_per_share) ? edge(r.pnl_cents_per_share / 100) : "—");
const winRate = (x: number | undefined) => (ok(x) ? `${Math.round(x * 100)}%` : "—");

/** One record as display strings (tables and tiles share it). */
export function fmtRecord(r: BacktestRecord | undefined) {
  const x = r ?? { flags: 0 };
  return {
    bets: int(x.flags), events: int(x.events), won: winRate(x.win_rate),
    ret: ret(x.roi_pct), cents: cents(x), t: tstat(x.t_stat),
  };
}

type TileKey = "bets" | "ret" | "cents" | "t" | "events";
export interface Tile { key: TileKey; label: string; help: string; value: number | undefined; text: string; baseline: string; baseline_value?: number }

/** Headline tiles: strategy (taker at the ask) vs "every bet, no filter" baseline. */
export function tiles(b: BacktestFile): Tile[] {
  const r = chosenResult(b);
  const s = r?.taker ?? { flags: 0 }, base = r?.baseline_all_bets_taker ?? { flags: 0 };
  const S = fmtRecord(s), B = fmtRecord(base);
  return [
    { key: "bets", label: "Best bets tested", help: "Bets that would have been best bets in weeks the model had never seen.", value: s.flags, text: S.bets, baseline: B.bets, baseline_value: base.flags },
    { key: "ret", label: "Average return (ROI)", help: "Average profit per dollar staked, after Polymarket's fee, buying at the estimated asking price.", value: s.roi_pct, text: S.ret, baseline: B.ret },
    { key: "cents", label: "Per $1 share", help: "Average profit in cents on a share that pays $1 if it hits.", value: s.pnl_cents_per_share, text: S.cents, baseline: B.cents },
    { key: "t", label: "Confidence (t-stat)", help: "How far the result sits from zero given its noise. Above 2 is unlikely to be luck alone.", value: s.t_stat, text: S.t, baseline: B.t },
    { key: "events", label: "Separate events", help: "Distinct games, weather days or questions. Bets on one event move together, so this is the honest sample size.", value: s.events, text: S.events, baseline: B.events, baseline_value: base.events },
  ];
}

const DAY = { month: "short", day: "numeric", timeZone: "UTC" } as const;

/** A test week's direction, judged at the precision its return is shown (lib/format ret: 1 decimal under 10%, whole
 *  % above). "up" only for a positive return that still reads above zero: +0.04% prints "+0%", so it is "flat"
 *  (break-even), never an up week. "none": no best bets that week. */
export type WeekDir = "up" | "down" | "flat" | "none";
export function weekDir(roiPct: number | null): WeekDir {
  if (roiPct === null || !ok(roiPct)) return "none";
  const a = Math.abs(roiPct);
  const shown = a >= 10 ? Math.round(a) : Number(a.toFixed(1));
  return shown === 0 ? "flat" : roiPct > 0 ? "up" : "down";
}

/** Weekly folds with dates formatted server-side (avoids hydration mismatch). Return is null on empty weeks. */
export function foldRows(b: BacktestFile) {
  const folds = (chosenResult(b)?.folds ?? []) as Fold[];
  return folds.map((f) => {
    const r = f.flags && ok(f.roi_pct) ? f.roi_pct : null;
    return {
      week: new Date(f.start * 1000).toLocaleDateString("en-US", DAY),
      bets: f.flags ?? 0,
      ret: r,
      retText: f.flags ? ret(f.roi_pct) : "no bets",
      dir: weekDir(r),
    };
  });
}

/** "N of M weeks up": weeks whose return is positive as shown (weekDir "up"); zero, break-even and empty weeks are
 *  not up. The one count every page uses (landing, Results). */
export const weeksUp = (rows: { dir: WeekDir }[]) => rows.filter((x) => x.dir === "up").length;

/** Predicted vs realized edge per bucket, in points per $1 share. */
export function bucketRows(b: BacktestFile) {
  const rows = (chosenResult(b)?.edge_buckets ?? []) as EdgeBucket[];
  return rows.map((e) => ({
    bucket: e.predicted_hi >= 1 ? `${Math.round(e.predicted_lo * 100)}+ pts` : `${Math.round(e.predicted_lo * 100)}–${Math.round(e.predicted_hi * 100)} pts`,
    bets: e.flags,
    predicted: +(e.predicted_edge * 100).toFixed(2),
    realized: +(e.realized_edge * 100).toFixed(2),
  }));
}

/** Rows of a record map, biggest sample first. */
export function recordRows(map: Record<string, BacktestRecord> | undefined) {
  return Object.entries(map ?? {})
    .sort((a, b) => (b[1].flags ?? 0) - (a[1].flags ?? 0))
    .map(([key, r]) => ({ key, r, f: fmtRecord(r) }));
}

/** P5: what a payout band's walk-forward record says, in plain words. A sign is called only when |t| >= 2; a big
 *  return with |t| < 2 still says which way it went ("lost money, too few bets to be sure"), never "break-even". */
export type PaysRead = "untested" | "few" | "even" | "won" | "lost" | "won?" | "lost?";
export function paysRead(r: BacktestRecord | undefined): PaysRead {
  if (!r?.flags) return "untested";
  if (r.flags < 30 || !ok(r.roi_pct)) return "few";
  if (ok(r.t_stat) && Math.abs(r.t_stat) >= 2) return r.roi_pct >= 0 ? "won" : "lost";
  if (Math.abs(r.roi_pct) < 10) return "even";
  return r.roi_pct >= 0 ? "won?" : "lost?";
}
export const PAYS_READ_TEXT: Record<PaysRead, string> = {
  untested: "No bets in testing", few: "Too few bets to tell", even: "About break-even, not enough bets to tell",
  won: "Made money", lost: "Lost money",
  "won?": "Made money, too few bets to be sure", "lost?": "Lost money, too few bets to be sure",
};
const SHORT: Record<PaysRead, string> = {
  untested: "untested", few: "too few bets to tell", even: "about break-even", won: "made money", lost: "lost money",
  "won?": "made money, small sample", "lost?": "lost money, small sample",
};

/** Per payout band: both tiers' records and the read of whichever tier tested more bets in that band. */
export function paysRows(r: { by_pays?: BacktestFile["results"][string]["by_pays"] } | null | undefined) {
  const bands = ["<1.5x", "1.5-2x", "2-3x", "3-5x", "5-10x", "10x+"] as const;
  return bands.map((key) => {
    const best = r?.by_pays?.best?.[key];
    const edge = r?.by_pays?.edge?.[key];
    const main = (edge?.flags ?? 0) > (best?.flags ?? 0) ? edge : best;
    return { key, best, edge, main, read: paysRead(main) };
  });
}

/** One line for the Pays filter: each 2x+ band's tested return, neighbours with the same read grouped. */
export function paysFilterNote(r: Parameters<typeof paysRows>[0]): string | null {
  const rows = paysRows(r).filter((x) => ["2-3x", "3-5x", "5-10x", "10x+"].includes(x.key) && x.read !== "untested");
  if (!rows.length) return null;
  const groups: { read: PaysRead; parts: string[] }[] = [];
  for (const x of rows) {
    const part = `${x.key.replace("-", "–")} ${ret(x.main!.roi_pct)}`;
    const last = groups[groups.length - 1];
    if (last?.read === x.read) last.parts.push(part);
    else groups.push({ read: x.read, parts: [part] });
  }
  return `In testing: ${groups.map((g) => `${g.parts.join(", ")}: ${SHORT[g.read]}.`).join(" ")}`;
}
