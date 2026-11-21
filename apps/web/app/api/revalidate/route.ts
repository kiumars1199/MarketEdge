// POST /api/revalidate (T-295): ops/upload.py calls it after each publish, so the prerendered pages
// (lib/static-routes.ts STATIC_PAGES) show the new scan within seconds instead of after their 300 s window.
// Auth: `Authorization: Bearer $REVALIDATE_SECRET` (falls back to CRON_SECRET), constant time (lib/cron.ts).
// No secret configured = every request is refused. Excluded from middleware.ts (no session, no account wall).
import { revalidatePath } from "next/cache";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { resetTop } from "@/lib/data/top";
import { STATIC_PAGES } from "@/lib/static-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!cronAuthorized(req, process.env.REVALIDATE_SECRET || process.env.CRON_SECRET)) return unauthorized();
  resetTop();   // this instance re-reads top.json, counts.json and backtest.json when it regenerates
  for (const p of STATIC_PAGES) revalidatePath(p);
  return Response.json({ revalidated: STATIC_PAGES, at: Math.floor(Date.now() / 1000) }, { headers: { "Cache-Control": "private, no-store" } });
}
