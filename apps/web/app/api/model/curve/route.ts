import { z } from "zod";
import { coarseCurve, curve, publicSegment } from "@/lib/data/model";
import { notFound, withTier } from "@/lib/data/respond";
import { can } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// docs/15: unknown keys rejected, values bounded. The segment is only a lookup key into model.json.
const Query = z.object({
  segment: z.string().max(120).default("all").transform((s) => s || "all"),
  h: z.coerce.number().min(0).max(24 * 365).default(24),
}).strict();

/** RT3-01: a curve interpolated at a market's mid gives its exact win chance. Paid tiers get the exact curve for any
 *  segment; Free / signed-out get only the segments /track-record charts ("all", "cat:<category>"), rounded to the
 *  width of Free's bands. Rate-limited for everyone. */
export function GET(req: Request) {
  const q = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json({ error: "bad query" }, { status: 400 });
  const { segment, h } = q.data;
  return withTier(req, "curve", (store, tier) => {
    const exact = can(tier, "exact_edge");
    if (!exact && !publicSegment(segment)) return Response.json({ error: "Niche curves are part of Pro" }, { status: 403 });
    const c = curve(store.model, segment, h);
    return c ? Response.json(exact ? c : coarseCurve(c)) : notFound("Curve");
  }, { bot: false });
}
