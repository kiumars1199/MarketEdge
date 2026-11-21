// Data export (docs/14 §1, CCPA access right): everything we hold for the user, as JSON.
import { readAll, withUser } from "@/lib/repo/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withUser(req, async (ctx) => {
    const { data: user } = await ctx.db.auth.getUser();
    const { data: profile } = await ctx.db.from("profiles").select("*").maybeSingle();
    const { data: subscription } = await ctx.db.from("subscriptions")
      .select("tier, status, current_period_end, cancel_at_period_end, trialed_at").maybeSingle();
    const body = {
      exported_at: new Date().toISOString(),
      account: { id: ctx.userId, email: user.user?.email, created_at: user.user?.created_at, accepted_terms_at: profile?.accepted_terms_at },
      subscription,
      ...(await readAll(ctx)),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="kismet-export-${body.exported_at.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
