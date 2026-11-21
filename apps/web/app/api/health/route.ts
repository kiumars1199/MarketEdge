// GET /api/health — uptime monitor target (docs/14 §5). 200 / 503 with {ok} only: component details tell a
// scraper which controls are off (RT-14), so they need `Authorization: Bearer $CRON_SECRET` (lib/health.ts).
import { cronAuthorized } from "@/lib/cron";
import { healthReport } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const report = await healthReport();
  return Response.json(cronAuthorized(req) ? report : { ok: report.ok }, {
    status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" },
  });
}
