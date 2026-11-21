// "Forgot password": POST { email } emails a reset link that lands on /reset-password (via /auth/callback, which
// marks this browser as having opened it). Always { ok: true } so it can't tell who has an account.
import { z } from "zod";
import { guard } from "@/lib/abuse";
import { RESET_PATH, perEmail } from "@/lib/auth/password";
import { authEnabled, sameOrigin, supabaseServer } from "@/lib/auth/server";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.email().max(254) }).strict();

export async function POST(req: Request) {
  if (!authEnabled()) return Response.json({ error: "Accounts are not set up yet" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const refused = await guard(req, "auth_ip");
  if (refused) return refused;
  const raw = await readJson(req, 2_048);
  if (raw === TOO_LARGE) return tooLarge();
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Enter a valid email" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const limited = await perEmail("auth_email", email, "reset emails");
  if (limited) return limited;
  const origin = new URL(req.url).origin;
  const { error } = await (await supabaseServer()).auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(RESET_PATH)}`,
  });
  if (error) console.error("[auth/reset]", error.status, error.message);   // never shown: same answer either way
  return Response.json({ ok: true });
}
