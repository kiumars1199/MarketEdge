// /api/settle/run — daily journal settlement + CLV, Vercel Cron (docs/05 F-12, docs/10 T-46, apps/web/vercel.json).
// Needs the cron secret. The demo journal settles client-side via POST /api/settle; this settles every
// user's Supabase journal rows with the service role. Idempotent: only changed fields are written.
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import { DEMO_MODE } from "@/lib/config";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { settleJournal } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return unauthorized();
  if (DEMO_MODE) return Response.json({ ran: false, reason: "demo mode settles the journal on page load" });
  if (!adminEnabled()) return Response.json({ ran: false, reason: "Supabase service role not configured" });
  try {
    return Response.json({ ran: true, ...(await settleJournal(supabaseAdmin())) });
  } catch (e) {
    console.error("[settle/run]", (e as Error).message);
    return Response.json({ ran: false, error: "settlement failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
