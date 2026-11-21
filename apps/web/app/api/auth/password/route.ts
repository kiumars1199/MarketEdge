// Email + password (docs/08): POST { action: "signup" | "signin", email, password, accept, next }.
// Sign-up sends a confirmation email (Supabase "Confirm email" must be on: a sign-up that comes back with a session
// is refused, so nobody can claim an address, an admin one included, without opening its inbox). Sign-in runs the
// same steps as the email-link callback (lib/auth/finish.ts). Answers never say whether an address has an account.
import { z } from "zod";
import { guard } from "@/lib/abuse";
import { isAdminEmail } from "@/lib/admin/core";
import { finishSignIn } from "@/lib/auth/finish";
import { Password, perEmail } from "@/lib/auth/password";
import { authEnabled, safeNext, sameOrigin, supabaseAdmin, supabaseServer } from "@/lib/auth/server";
import { rememberTerms, takeTerms } from "@/lib/auth/terms";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";
import { DEMO_MODE } from "@/lib/config";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["signup", "signin"]),
  email: z.email().max(254),
  password: Password,
  accept: z.boolean().optional(),
  next: z.string().max(512).optional(),
}).strict();

const WRONG = "Wrong email or password.";

export async function POST(req: Request) {
  if (!authEnabled()) return Response.json({ error: "Accounts are not set up yet" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const refused = await guard(req, "auth_ip");   // BotID + 5/min per IP
  if (refused) return refused;
  const raw = await readJson(req, 4_096);
  if (raw === TOO_LARGE) return tooLarge();
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const short = typeof (raw as { password?: unknown })?.password === "string" && ((raw as { password: string }).password.length < 8);
    return Response.json({ error: short ? "Use at least 8 characters for the password." : "Enter a valid email and password." }, { status: 400 });
  }
  const { action, password, accept } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const next = safeNext(parsed.data.next);
  const supabase = await supabaseServer();

  if (action === "signup") {
    if (accept !== true) return Response.json({ error: "Tick the box to confirm you're 18 or older and agree to the Terms." }, { status: 400 });
    const limited = await perEmail("auth_email", email, "sign-up emails");   // sends an email, like a magic link
    if (limited) return limited;
    const open = (await getSettings()).signups_open || isAdminEmail({ email, verified: true }, process.env.ADMIN_EMAILS, DEMO_MODE);
    if (!open) return Response.json({ error: "New sign-ups are paused right now. If you have an account, log in." }, { status: 403 });
    const origin = new URL(req.url).origin;
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (data?.session) {   // "Confirm email" is off in Supabase: fail closed, nobody gets an unverified account
      console.error("[auth/password] sign-up returned a session: turn on Confirm email in Supabase Auth");
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      if (data.user) await supabaseAdmin().auth.admin.deleteUser(data.user.id).catch(() => {});
      return Response.json({ error: "Sign-up with a password isn't available right now. Use the email link." }, { status: 503 });
    }
    if (error && error.status === 429) return Response.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });
    if (error && /password/i.test(error.message)) return Response.json({ error: "Choose a stronger password (at least 8 characters, not a common one)." }, { status: 400 });
    if (error) console.error("[auth/password] sign-up", error.status, error.message);   // logged, never shown: same answer
    // An existing address gets the same answer (Supabase sends nothing new), so this can't probe for accounts.
    await rememberTerms();
    return Response.json({ ok: true, confirm: true });
  }

  const limited = await perEmail("auth_password", email, "sign-in tries");
  if (limited) return limited;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.code === "email_not_confirmed") return Response.json({ error: "Confirm your email first: open the link we sent you." }, { status: 403 });
    if (error?.status === 429) return Response.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });
    return Response.json({ error: WRONG }, { status: 401 });
  }
  const to = await finishSignIn(supabase, data.user, next, async () => (accept ? new Date().toISOString() : takeTerms()));
  return Response.json({ ok: !to.startsWith("/login?error="), to });
}
