// Server-known state for the plan buttons (T-291 #12): billing and accounts come from env, the user and plan from the
// session, so the first HTML already has the right button and never flashes a disabled "Coming soon".
import "server-only";
import { authEnabled, getMe, type Me } from "@/lib/auth/server";
import { billingMode } from "@/lib/billing/stripe";
import { DEMO_MODE } from "@/lib/config";
import type { PlanCtx } from "@/components/pricing/Plans";

/** `me`: pass it when the page already has it (one auth lookup per request). */
export async function planCtx(me?: Pick<Me, "user" | "tier">): Promise<PlanCtx> {
  const m = me ?? (await getMe());
  return { demo: DEMO_MODE, auth: authEnabled(), billing: billingMode() !== null, signedIn: !!m.user, tier: m.tier };
}
