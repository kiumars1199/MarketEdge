// Continue with Google (docs/08). Form POST from /login (box ticked) → Google consent → /auth/callback.
import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/abuse";
import { authEnabled, safeNext, sameOrigin, supabaseServer } from "@/lib/auth/server";
import { rememberTerms } from "@/lib/auth/terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/login?${q}`, 303);
  if (!authEnabled() || !sameOrigin(req)) return back("error=unavailable");
  if (process.env.NEXT_PUBLIC_GOOGLE_AUTH !== "1") return back("error=google");   // provider not configured yet
  // A form navigation, so BotID can't attach its header here (docs/SECURITY_EVIDENCE.md); 5/min per IP still applies.
  if (await rateLimit("auth_ip", clientKey(req))) return back("error=rate");
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next")?.toString());
  if (form?.get("accept") !== "on") return back(`error=terms&next=${encodeURIComponent(next)}`);

  const { data, error } = await (await supabaseServer()).auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      scopes: "openid email profile",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) return back("error=google");
  await rememberTerms();
  return NextResponse.redirect(data.url, 303);
}
