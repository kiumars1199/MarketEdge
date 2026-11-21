// What every sign-in does once Supabase has a session (magic link / Google callback, password sign-in): closed
// sign-ups drop a brand-new account, the 18+/Terms acceptance is stored on first sign-in, then onboarding for
// new users or the `next` page. Returns the path to go to (an /login?error=… path on refusal, signed out).
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin/core";
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import { onFirstSignIn } from "@/lib/email/lifecycle";
import { DEMO_MODE } from "@/lib/config";
import { getSettings } from "@/lib/settings";

export async function finishSignIn(supabase: SupabaseClient, user: User, next: string, termsAt: () => Promise<string | null>): Promise<string> {
  const back = (error: string) => `/login?error=${error}&next=${encodeURIComponent(next)}`;
  const out = async (error: string) => { await supabase.auth.signOut({ scope: "local" }).catch(() => {}); return back(error); };
  const { data: profile } = await supabase
    .from("profiles").select("accepted_terms_at, onboarded_at").eq("user_id", user.id).maybeSingle();
  // Sign-ups closed (T-142): an account just created (Google, or a password sign-up confirmed later) is removed
  // again. Magic links can't create one (shouldCreateUser: false). Admin emails are always let in.
  const created = Date.parse(user.created_at ?? "") || 0;
  if (!profile?.accepted_terms_at && Date.now() - created < 10 * 60_000 && !(await getSettings()).signups_open &&
      !isAdminEmail({ email: user.email, verified: !!user.email_confirmed_at }, process.env.ADMIN_EMAILS, DEMO_MODE)) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    const { error: delErr } = await supabaseAdmin().auth.admin.deleteUser(user.id);
    if (delErr) console.error("[auth] closed sign-up cleanup failed", delErr.message);
    return back("closed");
  }
  if (!profile?.accepted_terms_at) {
    const at = await termsAt();
    if (!at) return out("terms");
    // Server-owned column (RT-11): the database refuses it from the user's own JWT, so the service role writes it.
    if (!adminEnabled()) return out("unavailable");
    const { error: saveErr } = await supabaseAdmin().from("profiles").update({ accepted_terms_at: at }).eq("user_id", user.id);
    if (saveErr) return out("unavailable");
    await onFirstSignIn(user);   // T-299/T-300: funnel "signup_done" (+ welcome email); awaited, never throws
  }
  return profile?.onboarded_at ? next : `/onboarding?next=${encodeURIComponent(next)}`;
}
