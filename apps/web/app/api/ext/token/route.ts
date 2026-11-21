// POST /api/ext/token → {token, exp, tier}: extension sign-in for the signed-in site user (docs/09 § Auth).
// Called by /ext/connect (same origin) or silently by the extension worker (cookies; demo mode needs none).
import { currentUser, issueExtToken, siteOrExtension } from "@/lib/trade/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!siteOrExtension(req)) return Response.json({ error: "Bad origin." }, { status: 403 });
  const user = await currentUser(req);
  if (!user) return Response.json({ error: "Sign in on Kismet first." }, { status: 401 });
  const t = issueExtToken(user, user.tier);
  if (!t) return Response.json({ error: "Extension sign-in isn't configured (EXT_SIGNING_SECRET)." }, { status: 503 });
  return Response.json(t, { headers: { "cache-control": "no-store" } });
}
