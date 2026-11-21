// POST /api/trade/nonce {action, payload} → {nonce}. Called by the ticket's confirm handler, same origin only.
// The nonce is bound to this exact order and expires in 2 minutes; other sites can't read it (no CORS) and
// can't message the extension (externally_connectable), so they can't fire orders through it.
import { NonceRequest } from "@/lib/trade/intent";
import { sameOrigin } from "@/lib/auth/server";
import { currentUser, issueNonce, tradingAllowed, tradingEnv } from "@/lib/trade/server";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!tradingEnv()) return Response.json({ error: "Trading is off." }, { status: 404 });
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin." }, { status: 403 });
  const user = await currentUser(req);
  if (!tradingAllowed(user?.email ?? null)) return Response.json({ error: "Trading isn't enabled for this account." }, { status: 403 });
  const raw = await readJson(req, 16_384);   // RT-12: bounded
  if (raw === TOO_LARGE) return tooLarge();
  const body = NonceRequest.safeParse(raw);
  if (!body.success) return Response.json({ error: "Bad order." }, { status: 400 });
  const nonce = issueNonce(body.data.action, body.data.payload);
  if (!nonce) return Response.json({ error: "Trading isn't configured (EXT_SIGNING_SECRET)." }, { status: 503 });
  return Response.json({ nonce }, { headers: { "cache-control": "no-store" } });
}
