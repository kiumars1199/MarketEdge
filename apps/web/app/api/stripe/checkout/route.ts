// Start an upgrade (docs/08): Stripe Checkout session, or a Payment Link with the user attached.
// Never grants access itself; the tier changes only when the webhook arrives.
import { z } from "zod";
import { guard } from "@/lib/abuse";
import { getUser, sameOrigin, supabaseServer } from "@/lib/auth/server";
import { PRICE_KEYS, billingMode, clientRef, paymentLinkUrl, priceId, stripeClient } from "@/lib/billing/stripe";
import { readJson, TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ price: z.enum(PRICE_KEYS) }).strict();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const raw = await readJson(req, 4_096);   // RT-12: bounded
  if (raw === TOO_LARGE) return tooLarge();
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Unknown plan" }, { status: 400 });
  const mode = billingMode();
  if (!mode) return Response.json({ error: "Billing is not set up yet" }, { status: 503 });
  const user = await getUser();
  if (!user) return Response.json({ error: "Sign in first", login: "/login?next=/pricing" }, { status: 401 });
  const refused = await guard(req, "checkout", user.id);   // BotID + 10/hour per account
  if (refused) return refused;

  const { price } = parsed.data;
  if (mode === "links") return Response.json({ url: paymentLinkUrl(price, user) });

  const { data: sub } = await (await supabaseServer())
    .from("subscriptions").select("stripe_customer_id, trialed_at").eq("user_id", user.id).maybeSingle();
  const origin = new URL(req.url).origin;
  try {
    const session = await stripeClient()!.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId(price), quantity: 1 }],
      client_reference_id: clientRef(user.id) ?? undefined,   // signed (RT-05), one verification path with Links
      ...(sub?.stripe_customer_id ? { customer: sub.stripe_customer_id } : { customer_email: user.email || undefined }),
      subscription_data: { metadata: { user_id: user.id }, ...(sub?.trialed_at ? {} : { trial_period_days: 7 }) },
      success_url: `${origin}/account?checkout=success`,
      cancel_url: `${origin}/pricing`,
    });
    return Response.json({ url: session.url });
  } catch (e) {
    console.error("[stripe] checkout failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't start checkout. Try again." }, { status: 502 });
  }
}
