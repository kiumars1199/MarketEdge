// Account deletion, shared by "Delete account" (/api/account) and the admin panel (/api/admin).
// Stripe first: a failed cancel must not leave a paying ghost. Then the Supabase user (every row cascades).
import "server-only";
import { supabaseAdmin } from "@/lib/auth/server";
import { stripeClient } from "@/lib/billing/stripe";

export type DeleteResult = { ok: true } | { ok: false; status: number; error: string };

export async function deleteAccount(userId: string, self = true): Promise<DeleteResult> {
  const db = supabaseAdmin();
  const { data: sub } = await db.from("subscriptions").select("stripe_subscription_id, status").eq("user_id", userId).maybeSingle();
  const stripe = stripeClient();
  if (sub?.stripe_subscription_id && sub.status !== "canceled") {
    if (!stripe) {
      return { ok: false, status: 409, error: self ? "Cancel your plan from Manage billing first, then delete the account." : "Stripe isn't configured, so the subscription can't be canceled. Nothing was deleted." };
    }
    try {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "resource_missing") {
        console.error("[account] stripe cancel failed", e instanceof Error ? e.message : e);
        return { ok: false, status: 502, error: `Couldn't cancel ${self ? "your" : "the"} subscription. Nothing was deleted. Try again.` };
      }
    }
  }
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[account] delete failed", error.message);
    return { ok: false, status: 502, error: "Couldn't delete the account. Try again." };
  }
  return { ok: true };
}
