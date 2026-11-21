// Stripe billing (docs/08 § Billing, docs/14 §2, docs/15 § Billing). Server only.
// Two modes, picked by config: Checkout (keys + price ids in env) or Payment Links (config/site.json).
// Either way the tier is written only here, from verified webhook events.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { site } from "@/lib/site";
import type { Tier } from "@/lib/entitlements";
import { sendEmail, unsubscribeUrl } from "@/lib/email";
import { paymentFailedEmail } from "@/lib/email/templates";
import { afterBillingEvent } from "@/lib/email/lifecycle";

export const PRICE_KEYS = ["pro_monthly", "pro_yearly", "premium_monthly", "premium_yearly"] as const;
export type PriceKey = (typeof PRICE_KEYS)[number];

const PRICE_ENV: Record<PriceKey, string> = {
  pro_monthly: "STRIPE_PRICE_PRO_MONTHLY", pro_yearly: "STRIPE_PRICE_PRO_YEARLY",
  premium_monthly: "STRIPE_PRICE_PREMIUM_MONTHLY", premium_yearly: "STRIPE_PRICE_PREMIUM_YEARLY",
};
export const priceId = (k: PriceKey) => process.env[PRICE_ENV[k]] ?? "";
const links = () => site.stripe.paymentLinks as Record<PriceKey, string>;

/** Stripe API client, or null when STRIPE_SECRET_KEY is empty. STRIPE_API_BASE (dev/e2e only) points it at a mock. */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const base = process.env.NODE_ENV !== "production" && process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  return new Stripe(key, base
    ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https", maxNetworkRetries: 0 }
    : { maxNetworkRetries: 2 });
}

/** "checkout" when keys + all 4 price ids are set (preferred), "links" when all 4 payment links are, else null. */
export function billingMode(): "checkout" | "links" | null {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return null;
  if (site.stripe.mode !== "links" && process.env.STRIPE_SECRET_KEY && PRICE_KEYS.every(priceId)) return "checkout";
  if (PRICE_KEYS.every((k) => links()[k])) return "links";
  return null;
}

// 7 days (RT3-09): a Checkout Session lives at most 24 h, but a Payment Link tab never expires, and a payer who comes
// back to it days later must still be upgraded. The MAC still binds the ref to one user; the window only limits replay.
export const CLIENT_REF_TTL_MS = 7 * 86_400_000;
const refMac = (secret: string, body: string) =>
  createHmac("sha256", createHash("sha256").update(`me:cref:${secret}`).digest()).update(body).digest("hex");

/** Signed client_reference_id (RT-05): `<user id>_<expiry ms>_<hex HMAC>`, keyed by the webhook secret.
 *  Stripe allows only letters, digits, - and _ there, so not the seal() format. Null without a secret. */
export function clientRef(userId: string, now = Date.now(), secret = process.env.STRIPE_WEBHOOK_SECRET): string | null {
  if (!secret || !/^[A-Za-z0-9-]{1,64}$/.test(userId)) return null;
  const body = `${userId}_${now + CLIENT_REF_TTL_MS}`;
  return `${body}_${refMac(secret, body)}`;
}

/** The user id in a reference we signed and that hasn't expired, else null (a raw or edited id is never trusted). */
export function verifyClientRef(ref: string | null | undefined, now = Date.now(), secret = process.env.STRIPE_WEBHOOK_SECRET): string | null {
  const m = ref && secret ? /^([A-Za-z0-9-]{1,64})_(\d{1,15})_([0-9a-f]{64})$/.exec(ref) : null;
  if (!m || Number(m[2]) < now) return null;
  const want = Buffer.from(refMac(secret!, `${m[1]}_${m[2]}`), "hex");
  return timingSafeEqual(want, Buffer.from(m[3]!, "hex")) ? m[1]! : null;
}

/** Payment Link with the user attached (signed, RT-05) so the webhook can match them (docs/14 §2). */
export function paymentLinkUrl(k: PriceKey, user: { id: string; email: string }): string {
  const u = new URL(links()[k]);
  const ref = clientRef(user.id);
  if (ref) u.searchParams.set("client_reference_id", ref);
  if (user.email) u.searchParams.set("prefilled_email", user.email);
  return u.toString();
}

/** Tier for a price: env price ids first, then price metadata.tier, then the amount (Payment Links have no ids in env). */
export function tierFromPrice(p: { id: string; unit_amount?: number | null; metadata?: Record<string, string> | null } | null | undefined): Tier | null {
  if (!p) return null;
  for (const k of PRICE_KEYS) if (priceId(k) && priceId(k) === p.id) return k.startsWith("premium") ? "premium" : "pro";
  const meta = p.metadata?.tier;
  if (meta === "pro" || meta === "premium") return meta;
  const hit = PRICE_KEYS.find((k) => Math.round(site.prices_usd[k] * 100) === p.unit_amount);   // in cents, no float equality
  return hit ? (hit.startsWith("premium") ? "premium" : "pro") : null;
}

const PAYING = new Set(["trialing", "active", "past_due"]);

export interface SubscriptionRow {
  stripe_customer_id: string; stripe_subscription_id: string; tier: Tier; status: string;
  current_period_end: string | null; cancel_at_period_end: boolean; trialed_at?: string;
}

/** What the webhook needs from the database. Production: supabaseBillingDb() (service role). Tests: in memory. */
export interface BillingDb {
  seen(eventId: string): Promise<boolean>;
  markSeen(eventId: string, type: string): Promise<void>;
  linkCustomer(userId: string, customerId: string): Promise<void>;
  userForCustomer(customerId: string): Promise<string | null>;
  /** The user's linked Stripe customer and subscription status, if any. */
  customerOf(userId: string): Promise<{ customer: string | null; status: string | null }>;
  emailFor(userId: string): Promise<string | null>;
  upsertSubscription(userId: string, row: SubscriptionRow): Promise<void>;
}

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

/** Subscription → row. tier = free unless status is trialing/active/past_due (docs/08). */
export function subscriptionRow(sub: Stripe.Subscription): SubscriptionRow {
  const item = sub.items?.data?.[0];
  const loose = sub as unknown as { current_period_end?: number };
  const end = loose.current_period_end ?? (item as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const tier = PAYING.has(sub.status) ? tierFromPrice(item?.price) ?? "free" : "free";
  return {
    stripe_customer_id: idOf(sub.customer)!,
    stripe_subscription_id: sub.id,
    tier, status: sub.status,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    ...(sub.trial_start ? { trialed_at: new Date(sub.trial_start * 1000).toISOString() } : {}),
  };
}

export class RetryLater extends Error {}

async function applySubscription(db: BillingDb, sub: Stripe.Subscription, userHint?: string | null) {
  const row = subscriptionRow(sub);
  const userId = userHint ?? sub.metadata?.user_id ?? (await db.userForCustomer(row.stripe_customer_id));
  // Payment Links: subscription events can beat checkout.session.completed. 500 → Stripe retries later.
  if (!userId) throw new RetryLater(`no user for customer ${row.stripe_customer_id}`);
  await db.upsertSubscription(userId, row);
}

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, premium: 2 };

/** Stripe doesn't deliver events in order, and a user can hold more than one subscription over time (cancel Pro, buy
 *  Premium; a late event for the old one arrives). So the tier comes from the customer's subscriptions as Stripe holds
 *  them now, not from the event: the paying one with the highest plan (newest on a tie); if none is paying, the
 *  event's subscription as Stripe has it (or the event, if Stripe no longer lists it). Errors retry (500). */
async function currentSubscription(stripe: Stripe | null, fromEvent: Stripe.Subscription): Promise<Stripe.Subscription> {
  if (!stripe) return fromEvent;
  const customer = idOf(fromEvent.customer);
  if (!customer) return fromEvent;
  const { data } = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
  const rank = (x: Stripe.Subscription) => TIER_RANK[subscriptionRow(x).tier as Tier];
  const paying = data.filter((x) => PAYING.has(x.status)).sort((a, b) => rank(b) - rank(a) || (b.created ?? 0) - (a.created ?? 0));
  return paying[0] ?? data.find((x) => x.id === fromEvent.id) ?? fromEvent;
}

export async function handleEvent(event: Stripe.Event, db: BillingDb, stripe: Stripe | null, secret?: string): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      // Only a reference we signed for this user (RT-05): a Payment Link's id is a URL parameter anyone can edit.
      const userId = verifyClientRef(s.client_reference_id, Date.now(), secret);
      const customer = idOf(s.customer);
      if (!userId || !customer) {
        if (s.client_reference_id) console.warn("[stripe] checkout with an unsigned or expired client_reference_id ignored", s.id);
        return;   // not ours (no verified user attached)
      }
      const had = await db.customerOf(userId);
      if (had.customer && had.customer !== customer && had.status && PAYING.has(had.status)) {
        console.error("[stripe] refusing to re-link a user with another active customer", s.id);
        return;
      }
      await db.linkCustomer(userId, customer);
      const subId = idOf(s.subscription);
      // A retried checkout for an earlier, since-canceled subscription must not override the one they pay for now.
      if (subId && stripe) await applySubscription(db, await currentSubscription(stripe, await stripe.subscriptions.retrieve(subId)), userId);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return applySubscription(db, await currentSubscription(stripe, event.data.object));
    case "invoice.payment_failed": {
      const customer = idOf(event.data.object.customer);
      const userId = customer && (await db.userForCustomer(customer));
      const email = userId && (await db.emailFor(userId));
      if (email) await sendEmail(paymentFailedEmail(email, unsubscribeUrl(userId)));
      return;
    }
    case "invoice.paid": {   // T-299/T-300: funnel "paid" + receipt in afterBillingEvent; listed so ops/stripe-setup.mjs subscribes
      const inv = event.data.object;
      const customer = idOf(inv.customer);
      // A charge can beat the event that links the customer (no-trial checkout, Payment Links): 500 → Stripe retries.
      if (inv.amount_paid > 0 && customer && !(await db.userForCustomer(customer))) throw new RetryLater(`no user for customer ${customer}`);
      return;
    }
    default:
      return;
  }
}

/** Verify (raw body, signature, 5-minute timestamp tolerance), dedupe by event.id, apply. */
export async function handleWebhook(req: Request, db: BillingDb, stripe: Stripe | null, secret = process.env.STRIPE_WEBHOOK_SECRET): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) return Response.json({ error: "Not configured or unsigned" }, { status: 400 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, sig, secret, 300);
  } catch {
    return Response.json({ error: "Bad signature" }, { status: 400 });
  }
  if (await db.seen(event.id)) return Response.json({ received: true, duplicate: true });
  try {
    await handleEvent(event, db, stripe, secret);
  } catch (e) {
    console.error("[stripe] webhook failed", event.type, event.id, e instanceof Error ? e.message : e);
    return Response.json({ error: "Retry" }, { status: 500 });
  }
  await afterBillingEvent(event, db);   // T-299/T-300: funnel steps and lifecycle emails; never throws
  await db.markSeen(event.id, event.type);   // after success, so a failed event is retried
  return Response.json({ received: true });
}
