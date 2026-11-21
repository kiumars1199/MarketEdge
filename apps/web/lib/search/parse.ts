// Smart search parser (docs/13 § Grammar). Pure: runs on the server (apply) and in the browser (chips).
// Tokens are pulled out left to right; whatever is left is free text, matched fuzzily by the index.
import type { FilterState, SortKey } from "@/lib/filters/state";
import { TAXONOMY } from "@/lib/taxonomy";
import type { MarketType } from "@/lib/types";
import { CONTEXT_ALIASES, TEXT_ALIASES, TOPIC_ALIASES } from "./aliases";

export const SLUG_URL = /polymarket\.com\/(?:[a-z]{2}\/)?(?:event|market)\/([^/?#\s]+)/i;

type Period = NonNullable<FilterState["periods"]>[number];
type ChipKind = "text" | "pays" | "price" | "chance" | "return" | "time" | "side" | "type" | "period" | "topic" | "sort" | "link";
export interface Chip { kind: ChipKind; label: string; raw: string }   // raw = the typed words (remove = cut them from q)

export interface ParsedQuery {
  text: string[];                       // leftover words, matched fuzzily
  pays?: [number, number]; price?: [number, number]; chance?: [number, number];
  roiMin?: number; closes?: { from: number; to: number }; live?: boolean;
  side?: FilterState["side"]; marketTypes?: MarketType[]; periods?: Period[]; topics?: string[];
  sort?: { key: SortKey; dir: "asc" | "desc" };
  chips: Chip[];
  liftsLongShotFloor: boolean;          // pays >= 2.5x, price <= 40¢, chance < 40%, or "long shot"
}
export interface ParseCtx { cities?: string[]; now?: number; tz?: string }

const H = 3_600_000, D = 24 * H;
const r2 = (x: number) => Math.round(x * 100) / 100;
const xs = (n: number) => `${r2(n)}x`;
const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const END = String.raw`(?=\s|$|[,;])`;
const re = (src: string) => new RegExp(`^(?:${src})${END}`, "i");

/** "≈ N" → [0.87N, 1.15N] (docs/13 Grammar). */
const around = (n: number): [number, number] => [r2(0.87 * n), r2(1.15 * n)];
/** American odds → multiplier: +200 → 3.0, −150 → 1.67. */
export const american = (sign: string, a: number) => (sign === "+" ? 1 + a / 100 : 1 + 100 / a);

// ---- time windows in the user's timezone --------------------------------------------------------------------
function offset(t: number, tz: string): number {
  try {
    const d = new Date(t);
    return Date.parse(d.toLocaleString("en-US", { timeZone: tz })) - Date.parse(d.toLocaleString("en-US", { timeZone: "UTC" }));
  } catch {
    return 0;   // unknown zone → UTC
  }
}
// ponytail: one offset for the whole window; a DST switch inside the window shifts its edge by an hour.
export function timeWindow(kind: string, now: number, tz = "UTC", hours = 0): { from: number; to: number } {
  const off = offset(now, tz);
  const sod = now + off - ((((now + off) % D) + D) % D) - off;   // local midnight today, as UTC ms
  const dow = new Date(now + off).getUTCDay();                    // 0 = Sunday
  switch (kind) {
    case "today": return { from: now, to: sod + D };
    case "tonight": return { from: now, to: sod + D + 4 * H };     // closes before 4 AM
    case "tomorrow": return { from: sod + D, to: sod + 2 * D };
    case "weekend": {
      if (dow === 6) return { from: now, to: sod + 2 * D };
      if (dow === 0) return { from: now, to: sod + D };
      const sat = sod + (6 - dow) * D;
      return { from: sat, to: sat + 2 * D };
    }
    case "hours": return { from: now, to: now + hours * H };
    default: return { from: now, to: now + 7 * D };               // "this week": the next 7 days
  }
}

// ---- rules ----------------------------------------------------------------------------------------------------
type Rule = [RegExp, (m: RegExpExecArray, p: ParsedQuery, ctx: Required<ParseCtx>) => Omit<Chip, "raw"> | null];

const STOP = new Set(["bet", "bets", "betting", "market", "markets", "the", "a", "an", "on", "for", "show", "me", "find",
  "any", "all", "games", "game", "match", "matches", "with", "and", "to", "of", "at", "vs", "vs.", "v", "odds", "pays", "pay", "paying", "payout", "around", "about", "~"]);

const PHRASES: Record<string, (p: ParsedQuery) => Omit<Chip, "raw">> = {
  "coin flip": (p) => ((p.chance = [0.4, 0.55]), { kind: "chance", label: "Coin flip (40–55%)" }),
  "coin flips": (p) => ((p.chance = [0.4, 0.55]), { kind: "chance", label: "Coin flip (40–55%)" }),
  "toss up": (p) => ((p.chance = [0.4, 0.55]), { kind: "chance", label: "Coin flip (40–55%)" }),
  "toss-up": (p) => ((p.chance = [0.4, 0.55]), { kind: "chance", label: "Coin flip (40–55%)" }),
  "long shot": (p) => ((p.chance = [0, 0.4]), { kind: "chance", label: "Long shots (under 40%)" }),
  "long shots": (p) => ((p.chance = [0, 0.4]), { kind: "chance", label: "Long shots (under 40%)" }),
  longshot: (p) => ((p.chance = [0, 0.4]), { kind: "chance", label: "Long shots (under 40%)" }),
  longshots: (p) => ((p.chance = [0, 0.4]), { kind: "chance", label: "Long shots (under 40%)" }),
  likely: (p) => ((p.chance = [0.8, 1]), { kind: "chance", label: "Likely (80%+)" }),
  "most likely": (p) => ((p.chance = [0.8, 1]), (p.sort = { key: "win_prob", dir: "desc" }), { kind: "chance", label: "Likely (80%+)" }),
  safe: (p) => ((p.chance = [0.8, 1]), { kind: "chance", label: "Likely (80%+)" }),
  safest: (p) => ((p.sort = { key: "win_prob", dir: "desc" }), { kind: "sort", label: "Most likely first" }),
  good: (p) => ((p.roiMin = 10), { kind: "return", label: "Return 10%+" }),
  "good edge": (p) => ((p.roiMin = 10), { kind: "return", label: "Return 10%+" }),
  "good value": (p) => ((p.roiMin = 10), { kind: "return", label: "Return 10%+" }),
  value: (p) => ((p.roiMin = 10), { kind: "return", label: "Return 10%+" }),
  edge: (p) => ((p.roiMin ??= 0.01), { kind: "return", label: "With an edge" }),
  great: (p) => ((p.roiMin = 20), (p.sort = { key: "roi", dir: "desc" }), { kind: "return", label: "Return 20%+" }),
  "great value": (p) => ((p.roiMin = 20), (p.sort = { key: "roi", dir: "desc" }), { kind: "return", label: "Return 20%+" }),
  // "best" sorts only: the docs/13 example "ufc tonight best" → sort best return (no 20% cut).
  best: (p) => ((p.sort = { key: "roi", dir: "desc" }), { kind: "sort", label: "Best return first" }),
  "highest return": (p) => ((p.sort = { key: "roi", dir: "desc" }), { kind: "sort", label: "Best return first" }),
  "best return": (p) => ((p.sort = { key: "roi", dir: "desc" }), { kind: "sort", label: "Best return first" }),
  soonest: (p) => ((p.sort = { key: "closes", dir: "asc" }), { kind: "sort", label: "Closing soon first" }),
  "closing soon": (p) => ((p.sort = { key: "closes", dir: "asc" }), { kind: "sort", label: "Closing soon first" }),
  "ending soon": (p) => ((p.sort = { key: "closes", dir: "asc" }), { kind: "sort", label: "Closing soon first" }),
  newest: (p) => ((p.sort = { key: "newest", dir: "desc" }), { kind: "sort", label: "Newest first" }),
  "biggest payout": (p) => ((p.sort = { key: "pays", dir: "desc" }), { kind: "sort", label: "Biggest payout first" }),
  "biggest payouts": (p) => ((p.sort = { key: "pays", dir: "desc" }), { kind: "sort", label: "Biggest payout first" }),
  live: (p) => ((p.live = true), { kind: "time", label: "Live now" }),
  yes: (p) => ((p.side = "yes"), { kind: "side", label: "Yes side" }),
  no: (p) => ((p.side = "no"), { kind: "side", label: "No side" }),
  ...Object.fromEntries(["favorite", "favorites", "favourite", "favourites", "fav", "favs"].map((w) => [w, (p: ParsedQuery) => ((p.side = "favorite"), { kind: "side" as const, label: "Favorites" })])),
  ...Object.fromEntries(["underdog", "underdogs", "dog", "dogs"].map((w) => [w, (p: ParsedQuery) => ((p.side = "underdog"), { kind: "side" as const, label: "Underdogs" })])),
  ...Object.fromEntries(([
    [["moneyline", "moneylines", "ml", "to win", "winner"], "moneyline", "Moneyline"],
    [["spread", "spreads", "handicap"], "spreads", "Spreads"],
    [["total", "totals", "o/u", "over/under"], "totals", "Totals"],
    [["prop", "props", "player props"], "props", "Props"],
  ] as [string[], MarketType, string][]).flatMap(([ws, t, label]) => ws.map((w) => [w, (p: ParsedQuery) => ((p.marketTypes = [...new Set([...(p.marketTypes ?? []), t])]), { kind: "type" as const, label })]))),
  ...Object.fromEntries(([
    [["1h", "first half", "1st half"], "1H", "First half"],
    [["2h", "second half", "2nd half"], "2H", "Second half"],
    [["1q", "first quarter", "1st quarter"], "1Q", "First quarter"],
  ] as [string[], Period, string][]).flatMap(([ws, per, label]) => ws.map((w) => [w, (p: ParsedQuery) => ((p.periods = [...new Set([...(p.periods ?? []), per])]), { kind: "period" as const, label })]))),
};

const TIME_WORDS: Record<string, [string, string]> = {
  today: ["today", "Closes today"], tonight: ["tonight", "Closes tonight"], tomorrow: ["tomorrow", "Closes tomorrow"],
  "this week": ["week", "Closes this week"], "this weekend": ["weekend", "Closes this weekend"], weekend: ["weekend", "Closes this weekend"],
};

const pays = (p: ParsedQuery, r: [number, number], label: string) => ((p.pays = r), { kind: "pays" as const, label });
const approxPays = (p: ParsedQuery, n: number) => pays(p, around(n), `Pays ~${xs(n)}`);

const RULES: Rule[] = [
  // return before chance: "+15%", "15% return"
  [re(String.raw`\+?${NUM}%\s*(?:return|roi|expected(?: return)?|profit)`), (m, p) => ((p.roiMin = +m[1]), { kind: "return", label: `Return ${+m[1]}%+` })],
  [re(String.raw`\+${NUM}%`), (m, p) => ((p.roiMin = +m[1]), { kind: "return", label: `Return ${+m[1]}%+` })],
  [re(String.raw`${NUM}%(?:\s*(?:chance|or more|or better|\+|likely|to win))?`), (m, p) => {
    const v = Math.min(100, +m[1]) / 100;
    p.chance = [v, 1];
    return { kind: "chance", label: `Chance ${Math.round(v * 100)}%+` };
  }],
  // price in cents
  [re(String.raw`(?:under|below|less than|max|cheaper than|<)\s*${NUM}\s*(?:c|¢|cents?)`), (m, p) => ((p.price = [0, Math.min(1, +m[1] / 100)]), { kind: "price", label: `Price under ${+m[1]}%` })],
  [re(String.raw`(?:over|above|more than|min|>)\s*${NUM}\s*(?:c|¢|cents?)`), (m, p) => ((p.price = [Math.min(1, +m[1] / 100), 1]), { kind: "price", label: `Price over ${+m[1]}%` })],
  [re(String.raw`${NUM}\s*(?:c|¢|cents?)`), (m, p) => ((p.price = [Math.max(0, (+m[1] - 3) / 100), Math.min(1, (+m[1] + 3) / 100)]), { kind: "price", label: `Price ~${+m[1]}%` })],
  // multipliers
  [re(String.raw`(?:under|below|less than|<)\s*${NUM}\s?x`), (m, p) => pays(p, [1, +m[1]], `Pays under ${xs(+m[1])}`)],
  [re(String.raw`${NUM}\s?x?\s*(?:-|–|to)\s*${NUM}\s?x`), (m, p) => pays(p, [+m[1], +m[2]], `Pays ${r2(+m[1])}–${xs(+m[2])}`)],
  [re(String.raw`${NUM}\s?x(?:\s*\+|\s+or more|\s+and up|\s+plus)`), (m, p) => pays(p, [+m[1], Infinity], `Pays ${xs(+m[1])}+`)],
  [re(String.raw`${NUM}\s?x|x${NUM}`), (m, p) => approxPays(p, +(m[1] ?? m[2]))],
  // American odds (+200 / −150), decimal odds (@2.5, 2.5 odds)
  [re(String.raw`([+\-−])(\d{3,5})`), (m, p) => approxPays(p, american(m[1] === "+" ? "+" : "-", +m[2]))],
  [re(String.raw`@\s?${NUM}|${NUM}\s+(?:decimal\s+)?odds`), (m, p) => approxPays(p, +(m[1] ?? m[2]))],
  // time: "in 6 hours", "next 6h"
  [re(String.raw`(?:in|next|within)\s+${NUM}\s*(?:h|hr|hrs|hours?)`), (m, p, c) => ((p.closes = timeWindow("hours", c.now, c.tz, +m[1])), { kind: "time", label: `Closes in ${+m[1]}h` })],
];

/** Phrase table (longest first) for words that need no number. */
function phraseRule(phrases: string[], fn: (hit: string, p: ParsedQuery, ctx: Required<ParseCtx>) => Omit<Chip, "raw"> | null): Rule {
  const alt = [...phrases].sort((a, b) => b.length - a.length).map(esc).join("|");
  return [re(`(${alt})`), (m, p, c) => fn(m[1]!.toLowerCase(), p, c)];
}

const topicLabel = (id: string) => TAXONOMY[id]?.label ?? id;
const addTopic = (p: ParsedQuery, id: string) => {
  p.topics = [...new Set([...(p.topics ?? []), id])];
  return { kind: "topic" as const, label: topicLabel(id) };
};

const WORD_RULES: Rule[] = [
  phraseRule(Object.keys(TIME_WORDS), (w, p, c) => {
    const [kind, label] = TIME_WORDS[w]!;
    p.closes = timeWindow(kind, c.now, c.tz);
    return { kind: "time", label };
  }),
  phraseRule(Object.keys(PHRASES), (w, p) => PHRASES[w]!(p)),
  phraseRule(Object.keys(TOPIC_ALIASES), (w, p) => addTopic(p, TOPIC_ALIASES[w]!)),
];

export function parse(q: string, ctx: ParseCtx = {}): ParsedQuery {
  const c: Required<ParseCtx> = { cities: ctx.cities ?? [], now: ctx.now ?? Date.now(), tz: ctx.tz ?? "UTC" };
  const p: ParsedQuery = { text: [], chips: [], liftsLongShotFloor: false };
  const raw = q.replace(/\s+/g, " ").trim();
  if (!raw) return p;
  const link = SLUG_URL.exec(raw);
  if (link) {
    p.chips.push({ kind: "link", label: "Polymarket link", raw });
    return p;
  }

  // Text aliases and cities: whole-word phrases, longest first. Cities come from the data (weather questions).
  const cities = c.cities.map((x) => x.toLowerCase()).filter((x) => x.length > 2);
  const textRule = phraseRule([...Object.keys(TEXT_ALIASES), ...Object.keys(CONTEXT_ALIASES), ...cities], () => null);
  const rules = [...RULES, ...WORD_RULES];
  let rest = raw;
  let city: string | null = null;
  let textChip: Chip | null = null;
  const pushText = (words: string, rawWords: string) => {
    p.text.push(...words.toLowerCase().split(" "));
    if (textChip) {
      textChip.raw += " " + rawWords;
      textChip.label += " " + title(words);
    } else p.chips.push((textChip = { kind: "text", label: title(words), raw: rawWords }));
  };

  outer: while (rest) {
    for (const [rx, fn] of rules) {
      const m = rx.exec(rest);
      if (!m) continue;
      const chip = fn(m, p, c);
      if (chip) {
        p.chips.push({ ...chip, raw: m[0] });
        textChip = null;
      }
      rest = rest.slice(m[0].length).trimStart();
      continue outer;
    }
    const t = textRule[0].exec(rest);
    if (t) {
      const w = t[1]!.toLowerCase();
      const words = TEXT_ALIASES[w] ?? w;
      if (cities.some((x) => x === words || x.startsWith(words + " "))) city = words;   // nyc → "new york" ⊂ "new york city"
      pushText(words, t[0]);
      rest = rest.slice(t[0].length).trimStart();
      continue;
    }
    const word = /^\S+/.exec(rest)![0];
    rest = rest.slice(word.length).trimStart();
    const clean = word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!clean || STOP.has(word.toLowerCase())) continue;
    pushText(clean, word);
  }

  // "spurs": Tottenham unless the query is about the NBA.
  for (const [w, a] of Object.entries(CONTEXT_ALIASES)) {
    const i = p.text.indexOf(w);
    if (i < 0) continue;
    const to = Object.entries(a.byTopic).find(([id]) => p.topics?.includes(id))?.[1] ?? a.default;
    p.text.splice(i, 1, ...to.split(" "));
    for (const ch of p.chips) if (ch.kind === "text") ch.label = ch.label.replace(new RegExp(`\\b${w}\\b`, "i"), title(to));
  }
  // A city on its own ("london", "nyc weather") means weather; "new york giants" does not.
  if (city && (!p.topics || p.topics.every((id) => id.startsWith("weather"))) && p.text.join(" ") === city) {
    if (!p.topics?.length) addTopic(p, "weather");
    for (const ch of p.chips) if (ch.kind === "text") ch.label = `City: ${title(city)}`;
  }

  p.liftsLongShotFloor = (p.pays?.[0] ?? 0) >= 2.5 || (p.price?.[1] ?? 1) <= 0.4 || (p.chance?.[1] ?? 1) <= 0.4;
  return p;
}

/** One line for the dropdown and chips: "Barcelona · Pays ~3x · Return 10%+". */
export const describe = (p: Pick<ParsedQuery, "chips">) => p.chips.map((c) => c.label).join(" · ");

/** q with one chip's words cut out. */
export const removeChip = (q: string, chip: Chip) => {
  const flat = q.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(chip.raw.toLowerCase());
  return (i < 0 ? flat : flat.slice(0, i) + flat.slice(i + chip.raw.length)).replace(/\s+/g, " ").trim();
};

/**
 * Merge a parsed query into the normal filter system. Filters set explicitly (pills, URL) win over typed words;
 * side and sort only take the typed value while they are at their defaults. `scanMs` = when hours_to_close was
 * measured (store.meta.scanned_at), so "closes today" lines up with the data.
 */
export function toFilterState(p: ParsedQuery, base: FilterState, scanMs = Date.now()): FilterState {
  const f: FilterState = { ...base };
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K] | undefined) => {
    if (v !== undefined && f[k] === undefined) f[k] = v;
  };
  if (p.pays) {
    set("pays_min", p.pays[0] > 1 ? p.pays[0] : undefined);
    set("pays_max", Number.isFinite(p.pays[1]) ? p.pays[1] : undefined);
  }
  if (p.price) {
    set("price_min", p.price[0] > 0 ? p.price[0] : undefined);
    set("price_max", p.price[1] < 1 ? p.price[1] : undefined);
  }
  if (p.chance) {
    set("win_prob_min", p.chance[0]);
    set("win_prob_max", p.chance[1] < 1 ? p.chance[1] : undefined);
  }
  if (p.liftsLongShotFloor) set("win_prob_min", 0);
  set("roi_min", p.roiMin);
  if (p.closes) {
    const after = (p.closes.from - scanMs) / H;
    set("closes_after_h", after > 0.05 ? r2(after) : undefined);
    set("closes_within_h", r2((p.closes.to - scanMs) / H));
  }
  if (p.live) set("live_only", true);
  if (p.side && base.side === "best") f.side = p.side;
  if (p.marketTypes) set("market_types", p.marketTypes);
  if (p.periods) set("periods", p.periods);
  if (p.topics) f.topics = [...new Set([...(base.topics ?? []), ...p.topics])];
  if (p.sort && base.sort.key === "roi" && base.sort.dir === "desc") f.sort = p.sort;
  return f;
}

// ---- honest fallback (docs/13 § No exact match) -------------------------------------------------------------------
export const RELAX_STEPS = ["return", "pays", "time", "text"] as const;
export type RelaxStep = (typeof RELAX_STEPS)[number];

/** The query with one more step relaxed, or null when that step changes nothing. */
export function relax(p: ParsedQuery, step: RelaxStep): ParsedQuery | null {
  const drop = (kinds: ChipKind[]) => p.chips.filter((c) => !kinds.includes(c.kind));
  switch (step) {
    case "return":
      return p.roiMin === undefined ? null : { ...p, roiMin: undefined, chips: drop(["return"]) };
    case "pays": {
      if (!p.pays) return null;
      const w: [number, number] = [r2(Math.max(1, p.pays[0] * 0.7)), Number.isFinite(p.pays[1]) ? r2(p.pays[1] * 1.3) : Infinity];
      const label = Number.isFinite(w[1]) ? `Pays ${r2(w[0])}–${xs(w[1])}` : `Pays ${xs(w[0])}+`;
      return { ...p, pays: w, chips: p.chips.map((c) => (c.kind === "pays" ? { ...c, label } : c)) };
    }
    case "time":
      return !p.closes && !p.live ? null : { ...p, closes: undefined, live: undefined, chips: drop(["time"]) };
    case "text":
      if (!p.text.length) return null;
      return { text: p.text, chips: p.chips.filter((c) => c.kind === "text"), liftsLongShotFloor: false };
  }
}

/** Banner: "No bets match all of Barcelona · Pays ~3x · Return 10%+ right now. Showing Barcelona · Pays 2–4x instead, best first." */
export const relaxedNote = (orig: ParsedQuery, shown: ParsedQuery) =>
  `No bets match all of ${describe(orig)} right now. Showing ${describe(shown) || "every match"} instead, best first.`;
