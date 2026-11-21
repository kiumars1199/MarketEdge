// GET /api/trade/config → whether the paper-trading ticket shows for this user (docs/16 §4).
import { KALSHI_RISK_URL } from "@/lib/trade/intent";
import { currentUser, extensionId, tradingAllowed, tradingEnv } from "@/lib/trade/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const env = tradingEnv();
  const id = extensionId();   // null in production without NEXT_PUBLIC_EXTENSION_ID: no ticket (RT-14)
  const user = env && id ? await currentUser(req) : null;
  const allowed = !!env && !!id && tradingAllowed(user?.email ?? null);
  return Response.json(
    { enabled: allowed, env, extensionId: id ?? "", riskUrl: KALSHI_RISK_URL },
    { headers: { "cache-control": "no-store" } },
  );
}
