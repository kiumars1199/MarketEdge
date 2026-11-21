// OAuth / magic-link / sign-up confirmation / password-reset landing (docs/08, docs/14 §1): exchange the code for a session (HttpOnly cookies),
// record the 18+/Terms acceptance, then onboarding for new users or the `next` page (default Best bets).
import { NextResponse } from "next/server";
import { authEnabled, safeNext, supabaseServer } from "@/lib/auth/server";
import { finishSignIn } from "@/lib/auth/finish";
import { RESET_PATH, markResetProof } from "@/lib/auth/password";
import { takeTerms } from "@/lib/auth/terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const go = (path: string) => NextResponse.redirect(new URL(path, url.origin), 303);
  const code = url.searchParams.get("code");
  // token_hash: a sign-in link an admin emailed from /admin (no PKCE verifier in this browser); the hash is the credential.
  const tokenHash = url.searchParams.get("token_hash");
  if (!authEnabled() || (!code && !tokenHash)) return go("/login?error=link");

  const supabase = await supabaseServer();
  const type = url.searchParams.get("type");
  const otpType = type === "recovery" || type === "signup" || type === "email" ? type : "magiclink";
  let recovery = false;
  let user = null;
  if (code) {
    const flowId = url.searchParams.get("sb_flow_id") ?? undefined;
    const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    // auth-js marks the PKCE verifier it stored for resetPasswordForEmail ("…/recovery"): only a reset requested
    // in this same browser and opened from the email reads as a recovery. Google or a plain email link never does.
    if (!error) { user = data.user; recovery = (data as { redirectType?: string | null }).redirectType === "recovery"; }
  } else {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType });
    if (!error) { user = data.user; recovery = otpType === "recovery"; }
  }
  // A sign-up confirmation opened in another browser still confirms the address (Supabase does that before it
  // redirects here); only this browser's session is missing. The "link" message says to log in with the password.
  if (!user) return go(`/login?error=link&next=${encodeURIComponent(next)}`);

  // a password-reset link lands on the set-password page; the signed marker proves this browser just opened it
  if (recovery) {
    await markResetProof(user.id);
    return go(await finishSignIn(supabase, user, RESET_PATH, takeTerms).then((to) => (to.startsWith("/login?error=") ? to : RESET_PATH)));
  }
  return go(await finishSignIn(supabase, user, next, takeTerms));
}
