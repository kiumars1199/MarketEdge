// Who am I + plan (docs/08 useEntitlements). Polled by the checkout success page, so never cached.
import { isAdminEmail } from "@/lib/admin/core";
import { authEnabled, getMe } from "@/lib/auth/server";
import { billingMode } from "@/lib/billing/stripe";
import { DEMO_MODE } from "@/lib/config";
import { navFeatures } from "@/lib/beta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getMe();
  return Response.json(
    // admin: decided here on the server from ADMIN_EMAILS; only shows or hides the header link (/admin checks again)
    { ...me, demo: DEMO_MODE, auth: authEnabled(), billing: billingMode() !== null, admin: isAdminEmail(me.user, process.env.ADMIN_EMAILS, DEMO_MODE), nav: navFeatures(me) },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
