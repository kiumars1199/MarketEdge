import type { MetaResponse } from "@/lib/api";
import { getMe } from "@/lib/auth/server";
import { withStore } from "@/lib/data/respond";
import { settledCount } from "@/lib/data/counts";
import { delayMin } from "@/lib/settings-core";
import { liveBase } from "@/lib/proof";
import { topicsOf } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tier-aware (AUDIT run 3 fail 1): Free and anon get the delayed scan's meta, matching the rows they are served.
// withStore marks the body private, no-store, Vary: Cookie, so no shared cache mixes tiers.
export async function GET() {
  const { tier } = await getMe();
  return withStore((store) => {
    const topics: Record<string, number> = {};
    for (const m of store.markets) for (const id of topicsOf(m)) topics[id] = (topics[id] ?? 0) + 1;
    const body: MetaResponse = {
      meta: store.meta,
      loaded_at: store.loadedAt,
      counts: { markets: store.markets.length, flags: store.flags.length, events: store.byEvent.size },
      facets: { ...store.facets, topics },
      delay_min: delayMin(tier),
      // QA-A #49/#63: each bet once (lib/data/counts.ts settledCount), the same base as /status and /track-record
      results: resultsOf(store.ledgerSummary),
    };
    return Response.json(body);
  }, undefined, tier);
}

function resultsOf(l: Parameters<typeof settledCount>[0]): MetaResponse["results"] {
  const c = settledCount(l);
  const b = liveBase(l);
  return c && b ? { graded: c.settled, wins: c.won, losses: c.lost, avg_pnl: b.avg_pnl } : null;
}
