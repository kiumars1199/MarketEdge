// Set a new password: POST { password }. Needs a session AND a reset email opened in this browser in the last
// 15 minutes (lib/auth/password markResetProof: signed, bound to this account), so a borrowed signed-in browser
// can't change it.
import { z } from "zod";
import { guard } from "@/lib/abuse";
import { Password, clearResetProof, hasResetProof } from "@/lib/auth/password";
import { authEnabled, getUser, sameOrigin, supabaseServer } from "@/lib/auth/server";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ password: Password }).strict();

export async function POST(req: Request) {
  if (!authEnabled()) return Response.json({ error: "Accounts are not set up yet" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const user = await getUser();
  const refused = await guard(req, "auth_ip", user?.id);
  if (refused) return refused;
  if (!user || !(await hasResetProof(user.id))) return Response.json({ error: "Open the reset link from your email again." }, { status: 401 });
  const raw = await readJson(req, 1_024);
  if (raw === TOO_LARGE) return tooLarge();
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Use 8 to 72 characters." }, { status: 400 });
  const { error } = await (await supabaseServer()).auth.updateUser({ password: parsed.data.password });
  if (error) return Response.json({ error: /password/i.test(error.message) ? "Choose a stronger password." : "Couldn't save it. Try again." }, { status: 400 });
  await clearResetProof();
  return Response.json({ ok: true });
}
