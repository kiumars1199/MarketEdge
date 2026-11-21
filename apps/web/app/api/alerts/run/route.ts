// /api/alerts/run — server alert evaluator, Vercel Cron (docs/05 F-11, docs/10 T-45, apps/web/vercel.json).
// Schedule: once a day ("0 13 * * *"), since a Hobby project rejects sub-daily crons (docs/setup-notes/ops.md). The
// alerts page and /pricing say "once a day" (#23/#64): change that copy if this schedule changes.
// Vercel Cron sends GET; POST is kept for manual runs and the post-scan trigger. Both need the cron secret.
// Evaluates every user's enabled Supabase alert_rules with the service role (lib/alerts-server.ts).
import { runServerAlerts } from "@/lib/alerts-server";
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import { liveExecution } from "@/lib/book";
import { DEMO_MODE } from "@/lib/config";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { marketsPage } from "@/lib/data/respond";
import { getStore } from "@/lib/data/store";
import { getSettings } from "@/lib/settings";

/** Last run's counts for the admin health page (app_settings "alerts_last_run"; not a setting, never audited). */
async function record(result: object) {
  const { error } = await supabaseAdmin().from("app_settings")
    .upsert({ key: "alerts_last_run", value: { at: new Date().toISOString(), ...result }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) console.error("[alerts/run] couldn't record the run:", error.message);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return unauthorized();
  if (DEMO_MODE) return Response.json({ ran: false, reason: "demo mode evaluates alerts in the browser" });
  if (!adminEnabled()) return Response.json({ ran: false, reason: "Supabase service role not configured" });
  if (!(await getSettings()).alerts_enabled) {   // admin kill switch (T-142)
    const out = { ran: false, reason: "alert sending is paused in admin settings" };
    await record(out);
    return Response.json(out);
  }
  try {
    const store = await getStore();   // live data: only Pro and Premium rules fire
    const counts = await runServerAlerts(supabaseAdmin(), {
      fetchMarkets: async (q) => marketsPage(store, q),
      fetchMarket: async (id) => store.flagsById.get(id) ?? store.byId.get(id) ?? null,
      fetchBook: liveExecution,
    });
    await record({ ran: true, ...counts });
    return Response.json({ ran: true, ...counts });
  } catch (e) {
    console.error("[alerts/run]", (e as Error).message);
    await record({ ran: false, error: "alert run failed" });
    return Response.json({ ran: false, error: "alert run failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
