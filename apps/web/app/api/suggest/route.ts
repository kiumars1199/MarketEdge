// GET /api/suggest?q=<typed text>&tz=<IANA zone>&view=flags  (docs/13 § Suggestions as you type)
// At most 9 rows: teams/players/cities (3), topics (2), markets (4); the browser adds saved views and the
// "Search all" row. Plus `line`, how the query is understood ("Barcelona · Pays ~3x"). Target < 50 ms.
import { z } from "zod";
import type { SuggestResponse } from "@/lib/api";
import type { Store } from "@/lib/data/store";
import { rangeSide } from "@/lib/data/gate";
import { withTier } from "@/lib/data/respond";
import { can } from "@/lib/entitlements";
import { apply, paysOf } from "@/lib/filters/apply";
import { FilterState } from "@/lib/filters/state";
import { TOPIC_ALIASES } from "@/lib/search/aliases";
import { describe, parse } from "@/lib/search/parse";
import { TAXONOMY, topicsOf } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().trim().max(120),
  tz: z.string().max(64).regex(/^[A-Za-z0-9_+\-/]+$/).optional(),
  view: z.enum(["markets", "flags"]).default("markets"),
}).strict();

// Open markets per topic, once per loaded store.
const topicCounts = new WeakMap<Store, Record<string, number>>();
function countsFor(store: Store) {
  let c = topicCounts.get(store);
  if (!c) {
    c = {};
    for (const m of store.markets) for (const id of topicsOf(m)) c[id] = (c[id] ?? 0) + 1;
    topicCounts.set(store, c);
  }
  return c;
}
const KEYS = Object.keys(TOPIC_ALIASES);

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({ q: sp.get("q") ?? "", tz: sp.get("tz") ?? undefined, view: sp.get("view") ?? undefined });
  if (!parsed.success) return Response.json({ error: "q must be at most 120 characters" }, { status: 400 });
  const { q, tz, view } = parsed.data;

  // Tier-shaped like /api/markets (docs/15): Free gets the delayed scan and returns as bands.
  return withTier(req, "suggest", (store, tier) => {
    const exact = can(tier, "exact_edge");
    const empty: SuggestResponse = { q, line: "", entities: [], topics: [], markets: [] };
    if (!q) return Response.json(empty);
    const p = parse(q, { cities: store.search.cities, tz, now: Date.now() });
    const text = p.text.join(" ");

    const entities = (text ? store.search.entities(text, 3) : []).flatMap((e) => {
      const rows = e.ids.flatMap((id) => store.byId.get(id) ?? []);
      if (!rows.length) return [];
      const best = rows.reduce((a, m) => (m.best.roi_pct > a.roi_pct ? m.best : a), rows[0]!.best);
      const s = exact ? best : rangeSide(best);
      return [{ name: e.name, count: rows.length, best_roi: s.roi_pct, ...(s.ranges ? { ranges: s.ranges } : {}) }];
    });

    // Topics: the last typed word as a prefix of a topic name or alias ("we" → Weather), minus topics already parsed.
    const last = q.toLowerCase().split(/\s+/).at(-1) ?? "";
    const counts = countsFor(store);
    const ids = last.length < 2 ? [] : [...new Set(KEYS.filter((k) => k.startsWith(last)).map((k) => TOPIC_ALIASES[k]!))];
    const topics = ids
      .filter((id) => !p.topics?.includes(id) && (counts[id] ?? 0) > 0)
      .map((id) => ({ id, label: TAXONOMY[id]?.label ?? id, count: counts[id]! }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 2);

    const page = apply(store, FilterState.parse({ q, tz, view, group_by_event: false, page_size: 4, ...(view === "flags" ? { verdicts: ["worth it", "thin"] } : {}) }));
    const markets = page.rows.map((r) => {
      const s = exact ? r.side : rangeSide(r.side);
      return {
        id: r.market.id, question: r.market.question, side_index: r.side.side_index,
        outcome: r.side.outcome, pays: paysOf(r.side), roi_pct: s.roi_pct, ...(s.ranges ? { ranges: s.ranges } : {}),
      };
    });

    const body: SuggestResponse = { q, line: describe(p), entities, topics, markets };
    return Response.json(body, { headers: { "Cache-Control": "private, max-age=30" } });
  });
}
