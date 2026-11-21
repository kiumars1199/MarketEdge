// /api/lifecycle/run: daily trial-ending reminder (docs/OVERHAUL.md §F4, T-300), Vercel Cron (apps/web/vercel.json).
// GET only (Vercel Cron sends GET; nothing mutating is reachable by POST). Needs the cron secret. Sends "your trial ends in 2 days, here's how to cancel" once per trial (lib/email/lifecycle.ts).
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import { DEMO_MODE } from "@/lib/config";
import { cronAuthorized, unauthorized } from "@/lib/cron";
import { defaultMail, runTrialReminders, type TrialRow } from "@/lib/email/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return unauthorized();
  if (DEMO_MODE) return Response.json({ ran: false, reason: "demo mode has no accounts" });
  const mail = defaultMail();
  if (!adminEnabled() || !mail) return Response.json({ ran: false, reason: "Supabase service role not configured" });
  const db = supabaseAdmin();
  try {
    const result = await runTrialReminders({
      trialing: async () => {
        const { data, error } = await db.from("subscriptions")
          .select("user_id, stripe_subscription_id, tier, status, current_period_end, cancel_at_period_end").eq("status", "trialing");
        if (error) throw new Error(error.message);
        return (data ?? []) as TrialRow[];
      },
      emailFor: async (userId) => (await db.auth.admin.getUserById(userId)).data.user?.email ?? null,
    }, mail);
    return Response.json({ ran: true, ...result });
  } catch (e) {
    console.error("[lifecycle/run]", (e as Error).message);
    return Response.json({ ran: false, error: "trial reminders failed" }, { status: 500 });
  }
}

export const GET = run;
