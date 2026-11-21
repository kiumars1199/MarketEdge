// POST /api/trade/nonce/verify {nonce, action, payload} → {ok}. Called by the extension right before it signs.
// Consumes the nonce: true once, only for the exact order it was issued for, within 2 minutes.
import { NonceRequest } from "@/lib/trade/intent";
import { consumeNonce, tradingEnv } from "@/lib/trade/server";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!tradingEnv()) return Response.json({ ok: false }, { status: 404 });
  const raw = await readJson(req, 16_384);   // RT-12: bounded
  if (raw === TOO_LARGE) return tooLarge();
  const { nonce, ...rest } = (raw ?? {}) as { nonce?: unknown };
  const body = NonceRequest.safeParse(rest);
  if (!body.success || typeof nonce !== "string" || nonce.length > 1024) return Response.json({ ok: false }, { status: 400 });
  const ok = await consumeNonce(nonce, body.data.action, body.data.payload);
  return Response.json({ ok }, { status: ok ? 200 : 403, headers: { "cache-control": "no-store" } });
}
