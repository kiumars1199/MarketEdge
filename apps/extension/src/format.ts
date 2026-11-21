// The few rules from apps/web/lib/format.ts the extension needs (docs/06 § Display language). Keep in sync.
const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const DASH = "—";

/** docs/18 §4 counts: under 1,000 exact, above rounded DOWN to one decimal, trailing ".0" dropped (9,666 → "9.6K",
 *  16,896 → "16.8K", 1,000 → "1K", 1,333,014 → "1.3M"). */
export function formatCount(n: number | null | undefined): string {
  if (!ok(n)) return DASH;
  const a = Math.floor(Math.abs(n));
  const sign = n < 0 ? "−" : "";
  if (a < 1000) return `${sign}${a}`;
  const [d, u] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const tenths = Math.floor(a / (d / 10));
  return `${sign}${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ""}${u}`;
}

/** 0.68 → "68%" (one decimal when not whole: 0.055 → "5.5%"). Users never see cents. */
/** 0.68 → "1.47x": what $1 returns if it wins, before the fee */
export const odds = (p: number | null | undefined) => (ok(p) && p > 0 && p < 1 ? `${1 / p >= 10 ? (1 / p).toFixed(1) : (1 / p).toFixed(2)}x` : DASH);
export function price(p: number | null | undefined): string {
  if (!ok(p)) return DASH;
  const c = p * 100;
  return `${Math.abs(c - Math.round(c)) < 0.05 ? Math.round(c) : c.toFixed(1)}%`;
}
/** Gross payout per $1 at this price (docs/13): 0.61 → "1.6x", 0.08 → "12x". */
export function pays(ask: number | null | undefined): string {
  if (!ok(ask) || ask <= 0) return DASH;
  const x = 1 / ask;
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}x`;
}
/** 0.79 → "79%" */
export const pct = (p: number | null | undefined) => (ok(p) ? `${Math.round(p * 100)}%` : DASH);
/** roi_pct 33.2 → "+33%", 4.6 → "+4.6%", -2 → "−2%" */
export function ret(roiPct: number | null | undefined): string {
  if (!ok(roiPct)) return DASH;
  const a = Math.abs(roiPct);
  const n = a >= 10 ? Math.round(a).toString() : a.toFixed(1).replace(/\.0$/, "");
  return `${roiPct < 0 ? "−" : "+"}${n}%`;
}
/** edge in points: 0.051 → "+5.1 pts" */
export const edge = (e: number | null | undefined) => (ok(e) ? `${e < 0 ? "−" : "+"}${Math.abs(e * 100).toFixed(1)} pts` : DASH);
/** $1,234 (whole dollars ≥ $100, cents below); signed adds +/− */
export function money(usd: number | null | undefined, signed = false): string {
  if (!ok(usd)) return DASH;
  const a = Math.abs(usd);
  const s = a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2).replace(/\.00$/, "");
  return `${signed ? (usd < 0 ? "−" : "+") : usd < 0 ? "−" : ""}$${s}`;
}
export function chance(p: number | null | undefined): string {
  if (!ok(p)) return DASH;
  return p >= 0.8 ? "Likely to hit" : p >= 0.55 ? "Leans your way" : p >= 0.4 ? "Coin flip" : "Long shot";
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
export const RETURN_HELP =
  "If you made this kind of bet many times, this is the average profit per dollar, based on how similar past bets resolved. Any single bet can lose.";
