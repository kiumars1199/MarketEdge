// Stripe webhook (docs/08): raw body signature check, 5-min timestamp tolerance, idempotent via stripe_events.
import { supabaseBillingDb } from "@/lib/billing/db";
import { handleWebhook, stripeClient } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Billing not configured" }, { status: 503 });
  }
  return handleWebhook(req, supabaseBillingDb(), stripeClient());
}
