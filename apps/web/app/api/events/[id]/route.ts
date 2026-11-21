import { noteRows } from "@/lib/abuse";
import { eventBody, notFound, withTier } from "@/lib/data/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTier(req, "markets", async (store, tier, me) => {
    const markets = store.byEvent.get(id);
    const body = markets && eventBody(store, markets, tier);
    if (!body) return notFound("Event");
    await noteRows(req, me.user?.id, body.markets.length);
    return Response.json(body);
  });
}
