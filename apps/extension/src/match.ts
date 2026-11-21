// Pure text matching: which market does a piece of page text name? No DOM here (unit-tested).
// Exact match on normalized text only; substrings would hit FAQ blocks, chart legends and comments.
import { pays, pct, ret } from "./format";
import type { Market } from "./types";

const norm = (s: string) =>
  s.toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim().replace(/[?.!:]+$/, "").trim();

// Sports game pages (/sports/<league>/<slug>) show no per-market labels, only section headings.
const HEADING: Record<string, string> = { moneyline: "Moneyline", spreads: "Spreads", totals: "Totals" };
const TEMP = /(\d+(?:-\d+)?°[FC](?: or (?:below|higher|above|lower))?)/;
const WILL_WIN = /^will (.+?) win\b/i;
// Game Lines headings cover full-game lines; halves, quarters and team totals live on other tabs.
const PARTIAL = /\b(1H|2H|[1-4]Q|half|quarter|team total|set \d|round \d)\b/i;

/** Labels Polymarket uses for this market's row, most specific first. */
function labels(m: Pick<Market, "question" | "market_type">): string[] {
  const out = [m.question];
  const t = m.question.match(TEMP);
  if (t) out.push(t[1]);
  // "Will Gavin Newsom win the 2028 ...?" → row "Gavin Newsom" (not on sports pages: team names sit in the header and chart)
  const w = m.question.match(WILL_WIN);
  if (w && (m.market_type === "multi-outcome" || m.market_type === "yes/no")) out.push(w[1]);
  return out.map(norm);
}

export interface Index { specific: Map<string, Market[]>; heading: Map<string, Market[]> }

export function buildIndex(markets: Market[]): Index {
  const idx: Index = { specific: new Map(), heading: new Map() };
  const add = (map: Map<string, Market[]>, k: string, m: Market) => map.set(k, [...(map.get(k) ?? []), m]);
  for (const m of markets) {
    for (const l of new Set(labels(m))) add(idx.specific, l, m);
    const h = HEADING[m.market_type];
    if (h && !PARTIAL.test(m.question)) add(idx.heading, norm(h), m);
  }
  return idx;
}

export interface Hit { market: Market; heading: boolean }

/** Market named by this exact text, best estimated return first, skipping ones already badged. */
export function match(text: string, idx: Index, used: Set<string> = new Set()): Hit | null {
  if (text.length > 160) return null;
  const k = norm(text);
  const pick = (ms?: Market[]) =>
    ms?.filter((m) => !used.has(m.id)).sort((a, b) => b.best.roi_pct - a.best.roi_pct)[0];
  const s = pick(idx.specific.get(k));
  if (s) return { market: s, heading: false };
  const h = pick(idx.heading.get(k));
  return h ? { market: h, heading: true } : null;
}

/** Badge copy (docs/06 § Display language): no cents, no verdict words. */
export function badgeText(m: Market, heading = false): { text: string; positive: boolean } {
  const b = m.best;
  const name = heading && m.market_type !== "moneyline" && m.question.length <= 28 ? `${m.question} · ` : "";
  if (b.roi_pct > 0)
    return { text: `${name}${b.outcome}: Pays ${pays(b.ask)} · won ${pct(b.win_prob)} before · market says ${pct(b.ask)} · ${ret(b.roi_pct)} estimated`, positive: true };
  const s = m.sides[0];
  const who = s.outcome === "Yes" ? "Market" : `${s.outcome}: market`;
  return { text: `${name}${who} says ${pct(s.ask)} · no edge`, positive: false };
}

/** Event slug from a Polymarket path: /event/<slug>[/<market>] or /sports/<league>/<slug>. */
export function slugFrom(pathname: string): string | null {
  const p = pathname.split("/").filter(Boolean);
  if (p[0] === "event") return p[1] ?? null;
  if (p[0] === "sports" && p.length >= 3) return p[p.length - 1];
  return null;
}
