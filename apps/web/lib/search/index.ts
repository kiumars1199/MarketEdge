// Search index (docs/13 § Matching and ranking), server only. MiniSearch over question (boost 3), event (2),
// outcomes (2), teams/players/cities (3), tags + niche + topic labels (1). Words are AND-ed with prefix matching;
// when that finds nothing, a second pass allows typos (1 edit for words of 5+ letters, 2 for 9+), so
// "barcelna" finds Barcelona while exact searches ("texans") never pick up look-alikes ("texas").
// A pasted Polymarket URL or event slug matches `slug`. Aliases are expanded by the parser (lib/search/parse.ts).
import MiniSearch, { type SearchOptions } from "minisearch";
import { TAXONOMY, topicsOf } from "@/lib/taxonomy";
import type { StoreMarket } from "@/lib/types";
import { SLUG_URL } from "./parse";

/** QA-A #47: letters NFKD leaves whole, spelled out, so "Bodø" is "bodo" (not "bod", which prefix-matched "The Body"). */
const FOLD: Record<string, string> = { "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "đ": "d", "ð": "d", "ł": "l", "þ": "th", "ı": "i" };
export const tokenize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[øæœßđðłþı]/g, (c) => FOLD[c]!).split(/[^a-z0-9.]+/).map((t) => t.replace(/^\.+|\.+$/g, "")).filter(Boolean);

const fuzzy = (term: string) => (/\d/.test(term) ? false : term.length >= 9 ? 2 : term.length >= 5 ? 1 : false);
const EXACT: SearchOptions = { combineWith: "AND", prefix: true };
const TYPO: SearchOptions = { ...EXACT, fuzzy };
const BOOST = { question: 3, event: 2, outcomes: 2, entities: 3, tags: 1 };

interface Entity { name: string; ids: string[] }   // a team, player or city and the markets that mention it
export interface SearchIndex {
  /** Matching market ids → score (higher = better). Empty query → null (no filter). */
  find(q: string): Map<string, number> | null;
  /** Markets of a pasted Polymarket URL or event slug, else null. */
  slug(q: string): Map<string, number> | null;
  /** Teams, players and cities whose name matches q (prefix + typo), best first. */
  entities(q: string, limit: number): Entity[];
  cities: string[];
}

const GENERIC = new Set(["yes", "no", "over", "under", "up", "down", "draw", "tie", "other"]);

/** Teams from "A vs. B" event titles and outcomes, players from props ("Name: …"), cities from weather questions. */
function entitiesOf(m: StoreMarket): string[] {
  const out: string[] = [];
  if (m.category === "sports") {
    const ev = m.event.replace(/\s+-\s+.*$/, "").replace(/^[^:]*:\s*/, "");
    const vs = ev.split(/\s+vs\.?\s+/i);
    if (vs.length === 2) out.push(...vs);
    for (const s of m.sides) if (!GENERIC.has(s.outcome.toLowerCase()) && s.outcome.length > 2) out.push(s.outcome);
    const who = /^([^:]+):/.exec(m.question)?.[1];
    if (m.market_type === "props" && who && !/\svs\.?\s/i.test(who) && !/^(exact score|set handicap)/i.test(who)) out.push(who);
  }
  if (m.derived.city) out.push(m.derived.city);
  return [...new Set(out.map((x) => x.trim()).filter((x) => x.length > 1))];
}

export function buildSearch(markets: StoreMarket[], bySlug: Map<string, StoreMarket[]>): SearchIndex {
  const ents = new Map<string, Entity>();
  const docs = markets.map((m) => {
    const names = entitiesOf(m);
    for (const n of names) {
      const k = n.toLowerCase();
      const e = ents.get(k) ?? ents.set(k, { name: n, ids: [] }).get(k)!;
      e.ids.push(m.id);
    }
    return {
      id: m.id, question: m.question, event: m.event,
      outcomes: m.sides.map((s) => s.outcome).join(" "),
      entities: names.join(" "),
      tags: [...m.tags, m.niche, ...[...topicsOf(m)].map((id) => TAXONOMY[id]?.label ?? "")].join(" "),
    };
  });
  const ms = new MiniSearch({ fields: Object.keys(BOOST), tokenize, searchOptions: { ...EXACT, boost: BOOST } });
  ms.addAll(docs);

  const entityList = [...ents.values()];
  const es = new MiniSearch({ fields: ["name"], tokenize, idField: "i" });
  es.addAll(entityList.map((e, i) => ({ i, name: e.name })));

  const cities = [...new Set(markets.flatMap((m) => (m.derived.city ? [m.derived.city] : [])))];

  const slug = (q: string) => {
    const raw = q.trim();
    const s = SLUG_URL.exec(raw)?.[1] ?? (/^[a-z0-9-]+$/i.test(raw) ? raw.toLowerCase() : null);
    const hits = s ? bySlug.get(s.toLowerCase()) : undefined;
    return hits ? new Map(hits.map((m) => [m.id, 1])) : null;
  };

  return {
    slug,
    cities,
    find(q) {
      if (!q.trim()) return null;
      const direct = slug(q);
      if (direct) return direct;
      if (!tokenize(q).length) return null;
      let res = ms.search(q, EXACT);
      if (!res.length) res = ms.search(q, TYPO);
      return new Map(res.map((r) => [String(r.id), r.score]));
    },
    entities(q, limit) {
      if (!tokenize(q).length) return [];
      let res = es.search(q, EXACT);
      if (!res.length) res = es.search(q, TYPO);
      return res
        .map((r) => ({ e: entityList[r.id as number]!, score: r.score }))
        .sort((a, b) => b.score - a.score || b.e.ids.length - a.e.ids.length)
        .slice(0, limit)
        .map((x) => x.e);
    },
  };
}
