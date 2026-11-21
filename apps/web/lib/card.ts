// The Best bets card in plain language (docs/OVERHAUL.md §B, docs/overhaul-contract.md § Card, rules R2-1, R2-4).
// Pure functions, unit-tested in test/card.test.ts: the card component only lays these out.
import { STRONG_RECORD_NEFF, money, odds } from "@/lib/format";
import type { Market, Side } from "@/lib/types";

const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

// ---------------------------------------------------------------------------------------------------------------
// Plain titles
// ---------------------------------------------------------------------------------------------------------------

type M = Pick<Market, "question" | "event" | "category" | "niche" | "market_type">;
type S = Pick<Side, "outcome" | "side_index">;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "November 17, 2026" → "Nov 17"; "on 2026-11-21" goes (the card shows the closing time). */
function dates(t: string): string {
  return t
    .replace(/\s+on \d{4}-\d{2}-\d{2}\b/g, "")
    .replace(new RegExp(`\\b(${MONTHS.join("|")}) (\\d{1,2})(?:,? \\d{4})?`, "g"), (_, mo: string, d: string) => `${mo.slice(0, 3)} ${d}`)
    .replace(/(\d)-(\d)/g, "$1–$2");
}
const tidy = (t: string) => dates(t.replace(/\s+/g, " ").replace(/\?+\s*$/, "").trim());
/** Club suffixes a fan never says: "Crystal Palace FC" → "Crystal Palace", "FC Barcelona" → "Barcelona". */
export const team = (n: string) => n.trim().replace(/^(?:FC|AFC|CF)\s+(?=\S)/, "").replace(/\s+(?:FC|AFC|CF)(?:\s+\d{4})?$/, "");
const isYes = (s: S) => /^yes$/i.test(s.outcome);
const isNo = (s: S) => /^no$/i.test(s.outcome);
const yesNo = (s: S) => isYes(s) || isNo(s);

/** "A vs. B" → [A, B] (event or question head). */
function teamsOf(text: string): [string, string] | null {
  const m = /^(?:[^:]*:\s+)?(.+?)\s+vs\.?\s+(.+?)(?:\s+-\s+.*)?$/.exec(text.trim());
  return m ? [team(m[1]!), team(m[2]!.replace(/\s*\(.*\)\s*$/, (x) => (/\((?:OH|FL|PA|NY)\)/.test(x) ? x : "")))] : null;
}
const PERIOD: Record<string, string> = {
  "1H": "the 1st half", "2H": "the 2nd half", "1Q": "the 1st quarter", "2Q": "the 2nd quarter", "3Q": "the 3rd quarter",
  "4Q": "the 4th quarter", "1st Half": "the 1st half", "2nd Half": "the 2nd half", "First Half": "the 1st half", "Second Half": "the 2nd half",
};
const periodOf = (t: string) => {
  const k = Object.keys(PERIOD).find((p) => new RegExp(`(^|\\s)${p}(\\s|$)`).test(t));
  return k ? PERIOD[k]! : null;
};
/** What a total or spread counts in this sport. */
function unitOf(m: M, text: string): string {
  if (/\brounds?\b/i.test(text)) return "rounds";
  if (/\bmaps?\b/i.test(text)) return "maps";
  if (/\bsets?\b/i.test(text)) return "sets";
  if (/\bgames?\b/i.test(text)) return "games";
  const n = m.niche.toLowerCase();
  if (/soccer|football(?!.*american)|nhl|hockey/.test(n) && !/nfl|cfb/.test(n)) return "goals";
  if (/mlb|baseball/.test(n)) return "runs";
  return "points";
}
const one = (n: number, unit: string) => (n === 1 ? unit.replace(/s$/, "") : unit);   // "more than 1 point"
const halfLine = (x: number) => Math.abs(x * 2 - Math.round(x * 2)) < 1e-9 && !Number.isInteger(x);

/** Over/under a line in whole units: over 52.5 → "53 or more points", under 0.5 → "no goals". */
function overUnder(over: boolean, line: number, unit: string): string {
  if (!halfLine(line) || unit === "rounds") return `${over ? "over" : "under"} ${line} ${unit}`;
  if (over) return `${Math.ceil(line)} or more ${unit}`;
  const n = Math.floor(line);
  return n === 0 ? `no ${unit}` : `${n} or fewer ${unit}`;
}
/** A handicap in plain words: -3.5 → "win by 4 or more points", +3.5 → "win, or lose by 3 or less". */
function margin(line: number, unit: string): string {
  const a = Math.abs(line);
  if (line < 0) return halfLine(a) ? `win by ${Math.ceil(a)} or more ${one(Math.ceil(a), unit)}` : `win by more than ${a} ${one(a, unit)}`;
  if (line > 0) return halfLine(a) ? `win, or lose by ${Math.floor(a)} or less` : `win, or lose by less than ${a} ${one(a, unit)}`;
  return "win";
}

type Rule = (m: M, s: S, q: string) => string | null;

const RULES: Rule[] = [
  // "Set Handicap: Harold Mayot (-1.5) vs Hugo Grenier (+1.5)", "Game Spread: A (-4.5) vs B (+4.5)"
  (m, s, q) => {
    const r = /^(.*?)(?:Handicap|Spread):\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)\s+vs\.?\s+(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)\s*$/.exec(q);
    if (!r) return null;
    const mine = team(s.outcome);
    const second = mine === team(r[4]!) || (mine !== team(r[2]!) && s.side_index === 1);
    const unit = unitOf(m, r[1]!);
    return `${mine} to ${margin(Number(second ? r[5] : r[3]), unit === "points" ? "points" : unit)}`;
  },
  // "Spread: Texans (-3.5)", "1H Spread: Broncos (-2.5)"
  (m, s, q) => {
    const r = /^(?:(\S+)\s+)?Spread:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)\s*$/.exec(q);
    if (!r) return null;
    const named = team(r[2]!), h = Number(r[3]);
    const mine = team(s.outcome);
    const line = mine === named ? h : -h;
    const per = r[1] ? periodOf(r[1]) : null;
    return `${mine} to ${margin(line, unitOf(m, q))}${per ? ` in ${per}` : ""}`;
  },
  // Totals: "Dolphins vs. Bills: O/U 52.5", "Steelers Team Total: O/U 20.5", "Wales vs. Portugal: Wales 1st Half O/U 0.5",
  // "O/U 2.5 Rounds"; player props "Jalen Green: Assists O/U 1.5" (Yes = over)
  (m, s, q) => {
    const r = /^(?:(.*?):\s*)?(.*?)\s*O\/U\s+(\d+(?:\.\d+)?)\s*(.*)$/.exec(q);
    if (!r) return null;
    const over = /^over\b/i.test(s.outcome) || isYes(s);
    const under = /^under\b/i.test(s.outcome) || isNo(s);
    if (!over && !under) return null;
    const head = r[1] ?? "", mid = r[2] ?? "", tail = r[4] ?? "";
    const line = Number(r[3]);
    const per = periodOf(`${head} ${mid}`);
    const midNoPer = mid.replace(/\b(1H|2H|1Q|2Q|3Q|4Q|1st Half|2nd Half|First Half|Second Half)\b/g, "").trim();
    const teams = teamsOf(head) ?? teamsOf(m.event);
    const perText = per ? ` in ${per}` : "";
    // player prop: "Jalen Green: Assists O/U 1.5"
    if (yesNo(s) && head && !teamsOf(head) && midNoPer) {
      const stat = midNoPer.toLowerCase();
      return `${head.trim()}: ${overUnder(over, line, stat)}${perText}`;
    }
    const teamTotal = /^(.*?)\s*Team Total$/i.exec(head) ?? /^(.*?)\s*(?:\d\w*\s+)?Team Total$/i.exec(midNoPer ? `${head} ${midNoPer}` : head);
    const unit = unitOf(m, `${q} ${tail}`);
    const game0 = teams ? `${teams[0]} vs ${teams[1]}` : null;
    if (/^total\b/i.test(midNoPer) && game0) return `${game0}: ${overUnder(over, line, unit)}${perText}`;
    if (teamTotal?.[1]) return `${team(teamTotal[1].replace(/\s+(1H|2H|1Q|2Q|3Q|4Q)$/, ""))} to score ${overUnder(over, line, unit)}${perText}`;
    if (midNoPer && teams) return `${team(midNoPer)} to score ${overUnder(over, line, unit)}${perText}`;
    const game = game0 ?? (m.event && m.event !== q ? tidy(m.event) : null);
    const ou = overUnder(over, line, unit);
    return game ? `${game}: ${ou}${perText}` : `${ou[0]!.toUpperCase()}${ou.slice(1)}${perText}`;
  },
  // "Will Crystal Palace FC win on 2026-11-21?"
  (m, s, q) => {
    const r = /^Will (.+?) win(?: on \d{4}-\d{2}-\d{2})?\?*$/.exec(q);
    if (!r || !yesNo(s)) return null;
    const who = team(r[1]!);
    if (isYes(s)) return `${who} to win`;
    const ts = teamsOf(m.event);
    const other = ts ? (ts[0] === who ? ts[1] : ts[1] === who ? ts[0] : null) : null;
    return other ? `${other} to win or draw` : `${who} not to win`;
  },
  // "Will Hungary vs. Northern Ireland end in a draw?"
  (_m, s, q) => {
    const r = /^Will (.+?) end in a draw\?*$/.exec(q);
    if (!r || !yesNo(s)) return null;
    const ts = teamsOf(r[1]!);
    if (!ts) return isYes(s) ? `${tidy(r[1]!)} to end in a draw` : `${tidy(r[1]!)} not to end in a draw`;
    return isYes(s) ? `${ts[0]} vs ${ts[1]} to end in a draw` : `${ts[0]} or ${ts[1]} to win`;
  },
  // "Exact Score: Liverpool FC 3 - 1 Manchester United FC?"
  (m, s, q) => {
    if (!/^Exact Score:/i.test(q) || !yesNo(s)) return null;
    const r = /^Exact Score:\s*(.+?)\s+(\d+)\s*-\s*(\d+)\s+(.+?)\?*$/.exec(q);
    if (!r) {
      const ts = teamsOf(m.event);
      const game = ts ? `${ts[0]} vs ${ts[1]}: ` : "";
      return isYes(s) ? `${game}a final score not on the usual list` : `${game}one of the usual final scores`;
    }
    const score = `${team(r[1]!)} ${r[2]}–${r[3]} ${team(r[4]!)}`;
    return isYes(s) ? `Final score exactly ${score}` : `Any final score but ${score}`;
  },
  // "Denmark vs. Norway: Both Teams to Score (in First Half)"
  (_m, s, q) => {
    const r = /^(.+?):\s*Both Teams to Score(?:\s+in\s+(.+?))?\?*$/i.exec(q);
    if (!r || !yesNo(s)) return null;
    const ts = teamsOf(r[1]!);
    const game = ts ? `${ts[0]} vs ${ts[1]}: ` : `${tidy(r[1]!)}: `;
    const per = r[2] ? ` in ${periodOf(r[2]) ?? r[2].toLowerCase()}` : "";
    return isYes(s) ? `${game}both teams to score${per}` : `${game}at least one team not to score${per}`;
  },
  // "Ball State vs. Ohio: 1H Moneyline", "Set 2 Winner: A vs B"
  (_m, s, q) => {
    if (yesNo(s)) return null;
    const r = /^(.+?):\s*(\S+)\s+Moneyline\s*$/i.exec(q);
    if (r) return `${team(s.outcome)} to win${periodOf(r[2]!) ? ` ${periodOf(r[2]!)}` : ""}`;
    const w = /^(Set|Map|Game|Round)\s+(\d+)\s+Winner:/i.exec(q) ?? /\s-\s(Set|Map|Game|Round)\s+(\d+)\s+Winner\s*$/i.exec(q);
    if (w) return `${team(s.outcome)} to win ${w[1]!.toLowerCase()} ${w[2]}`;
    return null;
  },
  // Weather: "Will the highest temperature in Munich be 12°C on November 17?" (between 72-73°F, 22°C or higher)
  (_m, s, q) => {
    const r = /^Will the (highest|lowest) temperature in (.+?) be (.+?) on (.+?)\?*$/i.exec(q);
    if (!r || !yesNo(s)) return null;
    const kind = r[1]!.toLowerCase() === "highest" ? "high" : "low";
    const where = r[2]!, when = dates(r[4]!);
    let v = r[3]!.replace(/^between\s+/i, "").replace(/(\d)-(\d)/g, "$1–$2");
    const up = /\s+or (?:higher|above|more)$/i.test(v), down = /\s+or (?:lower|below|less)$/i.test(v);
    v = v.replace(/\s+or (?:higher|above|more|lower|below|less)$/i, "");
    const yes = isYes(s);
    const what = up ? (yes ? `${v} or higher` : `under ${v}`)
      : down ? (yes ? `${v} or lower` : `above ${v}`)
      : (yes ? (/–/.test(v) ? v : `exactly ${v}`) : /–/.test(v) ? `outside ${v}` : `not ${v}`);
    return `${where} ${kind} ${what} on ${when}`;
  },
  // "Will it rain in Phoenix, AZ on November 17?"
  (_m, s, q) => {
    const r = /^Will it (rain|snow) in (.+?) on (.+?)\?*$/i.exec(q);
    if (!r || !yesNo(s)) return null;
    const w = r[1]!.toLowerCase();
    return `${isYes(s) ? w[0]!.toUpperCase() + w.slice(1) : `No ${w}`} in ${r[2]} on ${dates(r[3]!)}`;
  },
  // Crypto: "Will the price of Bitcoin be above $64,000 on November 21?", "... be between $62,000 and $64,000 on ..."
  (_m, s, q) => {
    const r = /^Will the price of (.+?) be (above|below|between) (.+?) on (.+?)\?*$/i.exec(q);
    if (!r || !yesNo(s)) return null;
    const coin = r[1]!, rel = r[2]!.toLowerCase(), v = r[3]!, when = dates(r[4]!);
    const yes = isYes(s);
    if (rel === "between") {
      const [a, b] = v.split(/\s+and\s+/);
      return yes ? `${coin} between ${a} and ${b} on ${when}` : `${coin} outside ${a}–${b} on ${when}`;
    }
    const word = yes ? rel : rel === "above" ? "at or below" : "at or above";
    return `${coin} ${word} ${v} on ${when}`;
  },
  // "Gold Up or Down - November 17, 10:15AM-10:30AM ET"
  (_m, s, q) => {
    const r = /^(.+?) Up or Down\s*-\s*(.+)$/i.exec(q);
    if (!r || !/^(up|down)$/i.test(s.outcome)) return null;
    return `${r[1]} to go ${s.outcome.toLowerCase()} (${dates(r[2]!)})`;
  },
];

/** Verbs that start the predicate of a "Will <subject> <verb> …?" question. */
const VERBS = new Set(("be win lose say post reach dip hit sell score have get make end transit finish close open rise fall " +
  "release announce launch take target top beat pass sign leave join become remain stay go happen visit meet resign drop " +
  "raise cut hold increase decrease approve ban return appear run lead qualify advance play record break land strike " +
  "invade attack agree file buy acquire merge default trade mention tweet").split(" "));

/** Generic "Will X do Y?" → "X to do Y" / "X not to do Y"; anything else → the question as a statement. */
function generic(m: M, s: S, q: string): string {
  const t = tidy(q);
  const there = /^Will there be\s+(.+)$/i.exec(t);
  if (there && yesNo(s)) return isYes(s) ? `${there[1]![0]!.toUpperCase()}${there[1]!.slice(1)}` : `Not ${there[1]}`;
  const will = /^Will\s+(.+)$/i.exec(t);
  if (will && yesNo(s)) {
    const words = will[1]!.split(" ");
    const i = words.findIndex((w, k) => k > 0 && VERBS.has(w.toLowerCase()));
    if (i > 0) {
      const subj = words.slice(0, i).join(" "), pred = words.slice(i).join(" ");
      return isYes(s) ? `${subj} to ${pred}` : `${subj} not to ${pred}`;
    }
    return isYes(s) ? will[1]! : `Not: ${will[1]}`;
  }
  if (yesNo(s)) return isYes(s) ? t : `No ${t}`;
  // named outcome on an unknown shape: a team or player in a head-to-head, else the outcome against the question
  const ts = teamsOf(q) ?? teamsOf(m.event);
  if (ts?.some((x) => x.toLowerCase() === team(s.outcome).toLowerCase() || x.toLowerCase().startsWith(team(s.outcome).toLowerCase())))
    return `${team(s.outcome)} to win`;
  return `${t}: ${s.outcome}`;
}

/** The bet in plain words for side `s` ("Crystal Palace to win", "Dolphins vs Bills: 53 or more points",
 *  "Bitcoin above $64,000 on Nov 21"). Never the raw "Will … on 2026-11-21?" question. */
export function plainTitle(m: M, s: S): string {
  const q = m.question.replace(/\s+/g, " ").trim();
  for (const rule of RULES) {
    const t = rule(m, s, q);
    if (t) return t.replace(/\s+/g, " ").trim();
  }
  return generic(m, s, q).replace(/\s+/g, " ").trim();
}

/** "Bet Under", "Bet Crystal Palace", "Bet No": the button the bettor taps on the venue. */
export const sideLabel = (s: Pick<Side, "outcome">) => `Bet ${team(s.outcome)}`;

// ---------------------------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------------------------

/** One denominator (R2-1): "about 7 in 10", "less than 1 in 10", "more than 9 in 10". Card only; the drawer, CSV
 *  and MCP keep lib/format winsAbout. */
export function winsInTen(p: number | null | undefined): string {
  if (!ok(p) || p <= 0) return "—";
  if (p < 0.05) return "less than 1 in 10";
  if (p >= 0.95) return "more than 9 in 10";
  // #14 (Mark, Nov 20): 85% read "about 9 in 10" beside "85%". One number still (R2-1), but halves round DOWN, so
  // the words never claim more than the percentage shown elsewhere: 85% → "about 8 in 10".
  return `about ${Math.max(1, Math.ceil(Math.round(p * 1000) / 100 - 0.5))} in 10`;
}

export const STAKE = 10;
/** What $10 brings back if it wins, after the fee: payout and profit (null without a price). */
export function on10(q: { ask: number | null; fee: number | null }, stake: number = STAKE): { back: number; profit: number } | null {
  if (!ok(q.ask) || !(stake > 0)) return null;
  const cost = q.ask + (ok(q.fee) ? q.fee : 0);
  if (!(cost > 0 && cost < 1)) return null;
  const back = stake / cost;
  return { back, profit: back - stake };
}
/** The card's money line as the multiplier bettors read (Q, Nov 20): "Pays 1.53x", after the fee. */
export function paysLine(q: { ask: number | null; fee: number | null }): string | null {
  const r = on10(q);
  return r ? `Pays ${multX(r.back / STAKE)}` : null;
}
/** A payout multiplier as every surface prints it: 1.391 → "1.39x", 12.34 → "12.3x", 150 → "150x". */
export const multX = (x: number) => `${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2)}x`;
/** Win chance as a plain percentage: 0.876 → "88% chance to win". */
export function chanceLine(p: number | null | undefined): string {
  if (!ok(p) || p <= 0) return "—";
  if (p < 0.01) return "Under 1% chance to win";
  if (p > 0.99) return "Over 99% chance to win";
  return `${Math.round(p * 100)}% chance to win`;
}
const cents = (x: number) => `$${x.toFixed(2)}`;
export const dollars = (x: number) => (x >= 1000 ? money(x) : cents(x));
/** "$10 wins $5.60": profit after fees on a $10 stake (the card's one money line). */
export function winsLine(q: { ask: number | null; fee: number | null }): string | null {
  const r = on10(q);
  return r ? `$${STAKE} wins ${dollars(r.profit)}` : null;
}
/** First line inside "Why this bet?": "If it wins you get $15.60 back ($10 + $5.60)". */
export function backLine(q: { ask: number | null; fee: number | null }, stake: number = STAKE): string | null {
  const r = on10(q, stake);
  return r ? `If it wins you get ${dollars(r.back)} back (${dollars(stake).replace(".00", "")} + ${dollars(r.profit)})` : null;
}

export type Stars = { n: 1 | 2 | 3; label: "Great value" | "Good value" | "Fair value" };
/** R2-4 value rating from the estimated return at today's price and how many similar past bets back it (model_neff).
 *  Thresholds on band low ends (lib/data/gate.ts ROI cuts 0/5/10/20/50) so Free's banded number gives the same stars:
 *    ★★★ Great value: return 20%+ with a strong record (STRONG_RECORD_NEFF, 100+ past bets)
 *    ★★  Good value:  return 20%+ on a thin record, or 10%+ with a strong record
 *    ★   Fair value:  any other return of 0% or more
 *  null = no value after fees at today's price (negative return, or no price); the card says so.
 *  On the real scan of 2026-11-16 this splits 1,069 Best bets 20 / 389 / 660. */
export function stars(s: { roi_pct: number | null | undefined; model_neff: number | null | undefined }): Stars | null {
  if (!ok(s.roi_pct) || s.roi_pct < 0) return null;
  const strong = ok(s.model_neff) && s.model_neff >= STRONG_RECORD_NEFF;
  if (s.roi_pct >= 20 && strong) return { n: 3, label: "Great value" };
  if (s.roi_pct >= 20 || (s.roi_pct >= 10 && strong)) return { n: 2, label: "Good value" };
  return { n: 1, label: "Fair value" };
}
export const starsHelp = (st: Stars | null) =>
  st === null ? "At today's price the fee takes the value out of this bet."
  : st.n === 3 ? "Great value: an estimated return of 20% or more, backed by 100+ similar past bets."
  : st.n === 2 ? "Good value: an estimated return of 20% or more on fewer past bets, or 10% or more backed by 100+ similar past bets."
  : "Fair value: priced a little under its chance of winning, after the fee.";

// ---------------------------------------------------------------------------------------------------------------
// Venue: the price, return and button a card shows (docs/OVERHAUL.md §G1)
// ---------------------------------------------------------------------------------------------------------------

export type CardVenue =
  /** Listed on Polymarket US: its price, fee and return; ask null = listed, no live US price right now. */
  | { kind: "us"; url: string; ask: number | null; fee: number | null; roi_pct: number | null }
  /** Not on Polymarket US (us === null): international price, no primary bet button. */
  | { kind: "intl-only"; ask: number; fee: number; roi_pct: number }
  /** Scan from before the US venue shipped (no `us` field at all): the international venue as before. */
  | { kind: "intl"; ask: number; fee: number; roi_pct: number };

/** The US quote prices the market's best side; any other side, or a market without a US twin, is international. */
export function cardVenue(m: Pick<Market, "us" | "best">, s: Pick<Side, "side_index" | "ask" | "fee" | "roi_pct">): CardVenue {
  const intl = { ask: s.ask, fee: s.fee, roi_pct: s.roi_pct };
  if (m.us === undefined) return { kind: "intl", ...intl };
  if (m.us && s.side_index === m.best.side_index) return { kind: "us", url: m.us.url, ask: m.us.ask, fee: m.us.fee, roi_pct: m.us.roi_pct };
  return { kind: "intl-only", ...intl };
}
export const US_SMALL_PRINT = "Polymarket US price, incl. its fee";
export const INTL_ONLY = "International only, not on Polymarket US";
export const NOT_FOR_US = "Not available to US residents";
export const priceText = (ask: number | null) => (ok(ask) ? odds(ask) : "—");
