// Manage billing (docs/08): Stripe Customer Portal (change plan, cancel, invoices, card).
import { getUser, sameOrigin, supabaseServer } from "@/lib/auth/server";
import { stripeClient } from "@/lib/billing/stripe";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const user = await getUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const fixed = process.env.STRIPE_PORTAL_URL || site.stripe.portal_url;
  const stripe = stripeClient();
  const { data: sub } = await (await supabaseServer())
    .from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (stripe && sub?.stripe_customer_id) {
    try {
      const s = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${new URL(req.url).origin}/account` });
      return Response.json({ url: s.url });
    } catch (e) {
      console.error("[stripe] portal failed", e instanceof Error ? e.message : e);
      if (!fixed) return Response.json({ error: "Couldn't open billing. Try again." }, { status: 502 });
    }
  }
  if (fixed) return Response.json({ url: fixed });
  return Response.json({ error: "No billing account yet" }, { status: 404 });
}
