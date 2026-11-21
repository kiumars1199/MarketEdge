import { liveMarketBody, notFound, withTier } from "@/lib/data/respond";
import { reveal } from "@/lib/data/reveals";
import { can, type Tier } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ?detail=1 = the details panel opening. Free: exact numbers for 3 markets a day (docs/08), ranges otherwise.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = new URL(req.url).searchParams.get("detail") === "1";
  return withTier(req, "markets", async (store, tier, me) => {
    const m = store.byId.get(id) ?? store.flagsById.get(id);
    if (!m) return notFound("Market");
    let shown: Tier = tier;
    let reveals_left: number | undefined;
    if (!can(tier, "exact_edge") && detail) {
      const r = await reveal(req, tier, me.user, id);
      if (r.ok) shown = "pro";
      reveals_left = r.left;
    }
    return Response.json({ ...(await liveMarketBody(store, m, tier, shown)), ...(reveals_left !== undefined ? { reveals_left } : {}) });
  });
}
