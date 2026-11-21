// GET  /api/combos/kalshi → { enabled } (whether the combo tray offers the Kalshi check)
// POST /api/combos/kalshi { legs: [{ ticker, side }] } → ComboQuote. 404 unless the person has Combos (Premium) and
// KALSHI_DATA_PERMISSION=true (docs/18 §5.3): the check lives in the combo tray, which only Premium sees.
import { ComboCheckBody, lookupCombo } from "@/lib/kalshiCombo";
import { getMe } from "@/lib/auth/server";
import { canBeta } from "@/lib/beta";
import { clientKey, rateLimit } from "@/lib/abuse";
import { sameOrigin } from "@/lib/auth/server";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowed = async () => { const me = await getMe(); return canBeta(me, "combos") && canBeta(me, "kalshi"); };
export const GET = async () => Response.json({ enabled: await allowed() }, { headers: { "cache-control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  if (!(await allowed())) return Response.json({ error: "Not available" }, { status: 404 });
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const limited = await rateLimit("book", clientKey(req));   // each call is two Kalshi requests
  if (limited) return limited;
  const raw = await readJson(req, 16_384);   // RT-12: bounded
  if (raw === TOO_LARGE) return tooLarge();
  const body = ComboCheckBody.safeParse(raw);
  if (!body.success) return Response.json({ error: "Send 2 to 6 Kalshi legs" }, { status: 400 });
  return Response.json(await lookupCombo(body.data), { headers: { "cache-control": "no-store" } });
}
