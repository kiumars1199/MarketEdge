// POST /api/oauth/decision (T-280): approve or deny an OAuth consent request (app/oauth/consent). Same-origin form
// posts only (CSRF), signed-in only; Supabase checks the request belongs to this user and returns where to send them.
import { NextResponse } from "next/server";
import { authEnabled, getUser, sameOrigin, supabaseServer } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9._~-]{1,256}$/;   // URL-safe; the format is Supabase's
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!authEnabled()) return fail(404, "Accounts are off");
  if (!sameOrigin(req)) return fail(403, "Bad origin");
  const form = await req.formData().catch(() => null);
  const id = form?.get("authorization_id")?.toString() ?? "";
  const decision = form?.get("decision")?.toString();
  if (!ID.test(id) || (decision !== "approve" && decision !== "deny")) return fail(400, "Invalid request");
  if (!(await getUser())) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`, req.url), 303);
  const oauth = (await supabaseServer()).auth.oauth;
  const { data, error } = decision === "approve"
    ? await oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) return fail(400, "This request has expired or was already used. Start again from the app.");
  return NextResponse.redirect(data.redirect_url, 303);
}
