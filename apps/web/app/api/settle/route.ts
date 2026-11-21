// POST /api/settle  body { ids: string[] } (Polymarket market ids from the local My bets journal)
// → { [id]: { resolved, winner_side_index: 0|1|null, closing_prices: [p0|null, p1|null] } }
// Demo-mode settlement (docs/05 F-12, docs/10 demo deltas). winner null + resolved = void (50/50).
// closing price = each side's last trade price before the market's end (CLOB prices-history), for CLV.
import { z } from "zod";
import { clientKey, rateLimit } from "@/lib/abuse";
import { sameOrigin } from "@/lib/auth/server";
import type { Settlement } from "@/lib/journal";
import { settleOne } from "@/lib/settle";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 200;

// docs/15: unknown keys rejected; ids are path-safe before they reach the Gamma URL.
const Body = z.object({ ids: z.array(z.string().regex(/^[\w-]{1,80}$/)).max(1_000) }).strict();

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const limited = await rateLimit("book", clientKey(req));
  if (limited) return limited;
  const raw = await readJson(req, 65_536);   // RT-12: bounded
  if (raw === TOO_LARGE) return tooLarge();
  const body = Body.safeParse(raw);
  if (!body.success) return Response.json({ error: "body must be { ids: string[] }" }, { status: 400 });
  const unique = [...new Set(body.data.ids)].slice(0, MAX_IDS);
  const out: Record<string, Settlement> = {};
  // ponytail: 8 concurrent Gamma calls; fine for a personal journal
  for (let i = 0; i < unique.length; i += 8) {
    const chunk = unique.slice(i, i + 8);
    const res = await Promise.all(chunk.map(settleOne));
    chunk.forEach((id, j) => { out[id] = res[j]!; });
  }
  return Response.json(out);
}
