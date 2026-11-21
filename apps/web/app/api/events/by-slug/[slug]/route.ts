// Used by the Chrome extension (docs/09): open CORS. Shaped by the caller's plan (T-44).
// T-276: needs an account. The middleware lets it through without cookies (the extension's worker sends none), so
// this route checks: a site session, or the extension's signed bearer token (lib/trade/server.ts). Else 401.
import { authEnabled, getUser } from "@/lib/auth/server";
import { eventBody, notFound, withTier } from "@/lib/data/respond";
import { verifyExtToken } from "@/lib/trade/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (authEnabled() && !verifyExtToken(req.headers.get("authorization")?.replace(/^Bearer /, "")) && !(await getUser())) {
    return Response.json({ error: "Sign in to use this." }, { status: 401, headers: { ...CORS, "Cache-Control": "private, no-store" } });
  }
  // No BotID: the Chrome extension calls this from its worker (no BotID script there); rate limit only.
  return withTier(req, "markets", (store, tier) => {
    const markets = store.bySlug.get(decodeURIComponent(slug).toLowerCase());
    const body = markets && eventBody(store, markets, tier);
    return body ? Response.json(body, { headers: CORS }) : notFound("Event", CORS);
  }, { headers: CORS, bot: false });
}
