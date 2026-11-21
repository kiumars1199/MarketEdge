// Sign out this device, or everywhere (docs/14 §1: revokes every session's refresh token).
import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/abuse";
import { authEnabled, sameOrigin, supabaseServer } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const refused = await rateLimit("auth_ip", clientKey(req));   // form navigation: rate limit, no BotID
  if (refused) return refused;
  if (authEnabled()) {
    const form = await req.formData().catch(() => null);
    const scope = form?.get("scope") === "global" ? "global" : "local";
    await (await supabaseServer()).auth.signOut({ scope });
  }
  return NextResponse.redirect(new URL("/", origin), 303);
}
