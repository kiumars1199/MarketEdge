// POST /api/ext/token/refresh (Authorization: Bearer <token>) → a fresh token while the old one is still valid.
// RT-10: each refresh re-checks the account (deleted or banned = 401) and re-reads the plan with the service role,
// and a chain of refreshes ends EXT_TOKEN_MAX_AGE_MS after the first sign-in (lib/trade/server.ts).
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import { DEMO_MODE } from "@/lib/config";
import { effectiveTier, type Tier } from "@/lib/entitlements";
import { issueExtToken, verifyExtToken } from "@/lib/trade/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const expired = () => Response.json({ error: "Expired. Sign in again." }, { status: 401 });

export async function POST(req: Request): Promise<Response> {
  const old = verifyExtToken(req.headers.get("authorization")?.replace(/^Bearer /, ""));
  if (!old) return expired();
  let user = { id: old.uid, email: old.sub };
  let tier: Tier = "premium";   // demo mode: no accounts, everyone is Premium (still bounded by iat0)
  if (!DEMO_MODE) {
    if (!adminEnabled()) return Response.json({ error: "Not configured." }, { status: 503 });
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.getUserById(old.uid);
    const u = data?.user;
    if (error || !u || (u.banned_until && Date.parse(u.banned_until) > Date.now())) return expired();
    const { data: sub, error: subErr } = await admin.from("subscriptions").select("*").eq("user_id", u.id).maybeSingle();
    if (subErr) return Response.json({ error: "Try again shortly." }, { status: 503 });
    user = { id: u.id, email: u.email ?? old.sub };
    tier = effectiveTier(sub);
  }
  const t = issueExtToken(user, tier, Date.now(), old.iat0);
  if (!t) return Response.json({ error: "Not configured." }, { status: 503 });
  return Response.json(t, { headers: { "cache-control": "no-store" } });
}
