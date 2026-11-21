// Combo (parlay) math, docs/18 §5. Pure: shared by the combo tray (client), suggested combos (server) and tests.
// Legs must come from different events (by event id, never by title: two events can share a name and one game can
// sit in two events); same-event legs are correlated and the simple product is wrong. Suggested combos never pair
// them, the tray refuses them (legProblem), and combo() still reports any that slip in (an old saved tray).
// One chance everywhere (Marc #15, #74): the return, "wins about" and every leg's chance use the cautious chance.
import { feeCents } from "@/lib/trade/intent";
import type { Side, StoreMarket } from "@/lib/types";

export interface Leg {
  market_id: string; side_index: 0 | 1;
  question: string; outcome: string; event_id: string; event: string;
  url: string; kalshi_ticker?: string | null;
  ask: number; fee: number;
  q: number;        // our win chance (win_prob)
  q_low: number;    // cautious win chance (win_prob_low)
  closes_at?: number;   // unix s; legs saved before Nov 21 have none
}
export const MIN_LEGS = 2;
/** Payout floors on the Combos page (docs/19 P5): 2x+, 3x+, 5x+, 10x+. */
export const COMBO_PAYS = [2, 3, 5, 10] as const;
export type ComboPays = (typeof COMBO_PAYS)[number];
export const MAX_LEGS = 6;

export const legOf = (m: Pick<StoreMarket, "id" | "question" | "event_id" | "event" | "url" | "kalshi_ticker"> & Partial<Pick<StoreMarket, "closes_at">>, s: Side): Leg => ({
  market_id: m.id, side_index: s.side_index, question: m.question, outcome: s.outcome, event_id: m.event_id, event: m.event,
  url: m.url, kalshi_ticker: m.kalshi_ticker ?? null, ask: s.ask, fee: s.fee, q: s.win_prob, q_low: s.win_prob_low,
  ...(m.closes_at ? { closes_at: m.closes_at } : {}),
});

export interface Combo {
  legs: number;
  q: number;            // Q = Π q_i
  q_low: number;        // Q_low = Π q_low_i ("combo confidence")
  price: number;        // fair combo price Π (ask_i + fee_i): buying each leg and rolling the winnings over
  pays: number;         // 1 / price
  ret: number;          // Q_low / price − 1: the return at the cautious chance the card shows (> 0 exactly when has_edge)
  has_edge: boolean;    // Q_low still beats the price
  same_event: string[]; // event names that appear on more than one leg (product is wrong for these)
}

const prod = (xs: number[]) => xs.reduce((a, b) => a * b, 1);

export function combo(legs: Pick<Leg, "ask" | "fee" | "q" | "q_low" | "event_id" | "event">[]): Combo {
  const q = prod(legs.map((l) => l.q));
  const q_low = prod(legs.map((l) => l.q_low));
  const price = prod(legs.map((l) => l.ask + l.fee));
  const ret = price > 0 ? q_low / price - 1 : 0;
  const seen = new Map<string, number>();
  for (const l of legs) seen.set(l.event_id, (seen.get(l.event_id) ?? 0) + 1);
  const same_event = [...new Set(legs.filter((l) => seen.get(l.event_id)! > 1).map((l) => l.event))];
  return { legs: legs.length, q, q_low, price, pays: price > 0 ? 1 / price : 0, ret, has_edge: q_low > price, same_event };
}

/** Kalshi combo (one contract that pays $1 if every leg wins): edge = Q − ask − fee(ask), fee per contract. */
export function kalshiComboEdge(q: number, askCents: number): { fee: number; edge: number; ret: number } {
  const fee = feeCents(1, askCents) / 100;
  const ask = askCents / 100;
  return { fee, edge: q - ask - fee, ret: (q - ask - fee) / (ask + fee) };
}

const DAY = 86_400;
/** Closes within a day of `now` (unix s) and hasn't closed yet. */
export const closesWithinDay = (closesAt: number, now: number) => closesAt > now && closesAt - now <= DAY;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? (\d{1,2})(?:(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2}))?(?:st|nd|rd|th)?\b(?:,? (\d{4}))?/gi;
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/** The last calendar day a title names ("November 18", "Nov 17-23", "Dec 5, 2026", "on 2026-11-21"), as the unix
 *  time that day ends everywhere on Earth (UTC−12). A date without a year takes the year that puts it nearest
 *  `anchor`: the market's close time when known ("by June 30?" closing July 2027 is June 2027), else now.
 *  null when the title names no date. */
export function titleDateEnds(title: string, anchor: number): number | null {
  const ends: number[] = [];
  const end = (y: number, m: number, d: number) => Date.UTC(y, m, d + 1) / 1000 + 12 * 3600;
  for (const [, y, m, d] of title.matchAll(ISO_RE)) ends.push(end(+y!, +m! - 1, +d!));
  for (const [, mo, d1, d2, y] of title.matchAll(MONTH_RE)) {
    const m = MONTHS.indexOf(mo!.slice(0, 3).toLowerCase());
    const d = +(d2 ?? d1!);
    if (m < 0 || d < 1 || d > 31) continue;
    if (y) { ends.push(end(+y, m, d)); continue; }
    const yr = new Date(anchor * 1000).getUTCFullYear();
    ends.push([yr - 1, yr, yr + 1].map((c) => end(c, m, d)).sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0]!);
  }
  return ends.length ? Math.max(...ends) : null;
}
/** Marc #42/#52: an open market whose title names a day that is over everywhere ("… on November 15?" on Nov 21). */
export const pastDated = (title: string, now: number, closesAt?: number): boolean => {
  const e = titleDateEnds(title, closesAt ?? now);
  return e !== null && e <= now;
};

/** Why a leg can't join these legs (null = it can). Same market again is a side switch, not a problem. */
export function legProblem(leg: Pick<Leg, "market_id" | "event_id" | "event" | "question" | "closes_at">, legs: Pick<Leg, "market_id" | "event_id">[], now: number): string | null {
  if (leg.closes_at !== undefined && leg.closes_at <= now) return "This market has closed, so it can't go in a combo.";
  if (pastDated(`${leg.question} ${leg.event}`, now, leg.closes_at)) return "This market's date has passed, so it can't go in a combo.";
  if (legs.some((l) => l.market_id !== leg.market_id && l.event_id === leg.event_id))
    return "Your combo already has a bet from this event. Results in one event move together, so pick a different event.";
  return null;
}
/** A saved leg that can no longer be bet: closed, or its date has passed. */
export const legGone = (l: Pick<Leg, "closes_at" | "question" | "event">, now: number) =>
  (l.closes_at !== undefined && l.closes_at <= now) || pastDated(`${l.question} ${l.event}`, now, l.closes_at);

const x = (p: number) => `${p >= 10 ? Math.round(p) : p.toFixed(1)}x`;
const words = ["", "One", "Two", "Three", "Four", "Five", "Six"];
/** Marc #65: the intro line built from the combos actually on screen, never a fixed "two or three":
 *  "Two-leg combos paying 2.1x to 4.5x", "Two- and three-leg combos paying 2.1x to 12x", "A two-leg combo paying 3.2x". */
export function rangeLine(combos: Pick<Combo, "legs" | "pays">[]): string | null {
  if (!combos.length) return null;
  const sizes = [...new Set(combos.map((c) => c.legs))].sort((a, b) => a - b).map((n) => words[n]?.toLowerCase() ?? String(n));
  const lo = Math.min(...combos.map((c) => c.pays)), hi = Math.max(...combos.map((c) => c.pays));
  const pay = x(lo) === x(hi) ? x(lo) : `${x(lo)} to ${x(hi)}`;
  if (combos.length === 1) return `A ${sizes[0]}-leg combo paying ${pay}`;
  const legs = sizes.length === 1 ? `${sizes[0]}-leg` : `${sizes.slice(0, -1).map((w) => `${w}-`).join(", ")} and ${sizes.at(-1)}-leg`;
  return `${legs[0]!.toUpperCase()}${legs.slice(1)} combos paying ${pay}`;
}

/** "Combo · 3 legs · pays 4.1x · wins about 1 in 3" */
export const comboLabel = (c: Pick<Combo, "legs" | "pays">, wins: string) =>
  `Combo · ${c.legs} legs · pays ${c.pays >= 10 ? Math.round(c.pays) : c.pays.toFixed(1)}x · wins about ${wins}`;
