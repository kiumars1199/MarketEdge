// GET /api/kalshi → Kalshi markets (top MAX by volume) and Kalshi Combos from output/kalshi.json (docs/03 § kalshi.json).
// 404 unless canBeta("kalshi") (live for every signed-in plan once KALSHI_DATA_PERMISSION=true, docs/16 §2) and the scan
// wrote the file. Signed out: 401 from the account wall (middleware). Same body for every plan, but behind sign-in, so
// never in a shared cache (QA-D: a public s-maxage would hand it to signed-out visitors from the CDN).
import { getMe } from "@/lib/auth/server";
import { canBeta } from "@/lib/beta";
import { getKalshi } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MARKETS = 200;

export async function GET(): Promise<Response> {
  const data = canBeta(await getMe(), "kalshi") ? await getKalshi() : undefined;
  if (!data) return Response.json({ error: "Not available" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(
    { ...data, markets: data.markets.slice(0, MAX_MARKETS) },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
