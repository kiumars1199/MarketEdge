// Lifecycle hooks (docs/OVERHAUL.md §F3–F4): what happens after a first sign-in, after each Stripe webhook event, and
// once a day for trials about to end.
// T-299: the server funnel steps (signup_done, trial_start, paid).
// T-300: lifecycle emails: welcome (first sign-in), receipt (first charge), cancel confirmation (subscription set to
//        cancel, or ended), trial ending (daily cron, /api/lifecycle/run). Templates: ./lifecycle-templates.ts.
// Each email goes out once: the server claims (user, kind, ref) in lifecycle_emails before sending and releases the claim
// when the send fails, so a later trigger (Stripe retry, next day's cron) can try again; a duplicate is never sent.
// Never throws: a hook failing must not fail a sign-in or make Stripe retry a billing event that was applied.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { BillingDb } from "@/lib/billing/stripe";
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import { recordFunnel, type FunnelDeps } from "@/lib/funnel-server";
import { sendEmail, unsubscribeUrl, type Email } from "./index";
import { cancelEmail, planName, receiptEmail, trialEndingEmail, welcomeEmail } from "./lifecycle-templates";

/** A first sign-in older than this is an existing account accepting the terms late, not a sign-up. */
export const NEW_ACCOUNT_MS = 86_400_000;
/** The daily cron sends the trial reminder when the trial ends within this window: "ends in 2 days" on day 5 of 7. */
export const TRIAL_NOTICE_MS = 2.5 * 86_400_000;

export type LifecycleKind = "welcome" | "trial_ending" | "receipt" | "cancel";

/** lifecycle_emails (supabase/migrations/20261120000300_lifecycle_emails.sql). */
export interface ClaimStore {
  /** true = this caller owns (user, kind, ref) now and should send; false = already sent (or being sent elsewhere). */
  claim(userId: string, kind: LifecycleKind, ref: string): Promise<boolean>;
  release(userId: string, kind: LifecycleKind, ref: string): Promise<void>;
}

export interface MailDeps {
  claims: ClaimStore;
  send: (e: Email) => Promise<{ sent: boolean }>;
  /** The user's subscriptions row as the webhook just left it (plan for a receipt; which subscription is current). */
  subOf: (userId: string) => Promise<{ tier: string | null; stripe_subscription_id: string | null } | null>;
  unsubscribe: (userId: string) => string;
}

export interface LifecycleDeps {
  funnel?: FunnelDeps;
  /** null = no lifecycle email. Default: Supabase service role + Resend (defaultMail). */
  mail?: MailDeps | null;
  now?: () => number;
}

export function supabaseClaims(db: SupabaseClient): ClaimStore {
  return {
    claim: async (user_id, kind, ref) => {
      const { data, error } = await db.from("lifecycle_emails")
        .upsert({ user_id, kind, ref }, { onConflict: "user_id,kind,ref", ignoreDuplicates: true }).select("kind");
      if (error) throw new Error(`lifecycle_emails: ${error.message}`);   // e.g. migration not applied: send nothing
      return (data?.length ?? 0) > 0;
    },
    release: async (user_id, kind, ref) => {
      await db.from("lifecycle_emails").delete().eq("user_id", user_id).eq("kind", kind).eq("ref", ref);
    },
  };
}

export function defaultMail(): MailDeps | null {
  if (!adminEnabled()) return null;
  const db = supabaseAdmin();
  return {
    claims: supabaseClaims(db),
    send: sendEmail,
    subOf: async (userId) => (await db.from("subscriptions").select("tier, stripe_subscription_id").eq("user_id", userId).maybeSingle()).data ?? null,
    unsubscribe: (userId) => unsubscribeUrl(userId),
  };
}

const mailOf = (deps: LifecycleDeps) => (deps.mail === undefined ? defaultMail() : deps.mail);

/** Claim, build, send; release the claim if building or sending fails or email is switched off. true = delivered. */
export async function sendOnce(mail: MailDeps, userId: string, kind: LifecycleKind, ref: string, build: () => Email | Promise<Email>): Promise<boolean> {
  if (!(await mail.claims.claim(userId, kind, ref))) return false;
  try {
    if ((await mail.send(await build())).sent) return true;
  } catch (e) {
    await mail.claims.release(userId, kind, ref).catch(() => {});
    throw e;
  }
  await mail.claims.release(userId, kind, ref).catch(() => {});   // Resend not configured: let a later trigger send it
  return false;
}

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);
const log = (what: string, e: unknown) => console.error(`[lifecycle] ${what} failed:`, e instanceof Error ? e.message : e);

/** lib/auth/finish.ts, right after a first sign-in stored the 18+/Terms acceptance. */
export async function onFirstSignIn(user: { id: string; email?: string | null; created_at?: string }, deps: LifecycleDeps = {}): Promise<void> {
  try {
    const now = (deps.now ?? Date.now)();
    const created = Date.parse(user.created_at ?? "");
    if (!Number.isFinite(created) || now - created > NEW_ACCOUNT_MS) return;
    await recordFunnel("signup_done", user.id, {}, deps.funnel);
    const mail = mailOf(deps);
    const to = user.email;
    if (mail && to) await sendOnce(mail, user.id, "welcome", "", () => welcomeEmail(to, mail.unsubscribe(user.id)));
  } catch (e) {
    log("first sign-in hook", e);
  }
}

/** lib/billing/stripe.ts handleWebhook, after an event was applied (once per event id). */
export async function afterBillingEvent(event: Stripe.Event, db: Pick<BillingDb, "userForCustomer" | "emailFor">, deps: LifecycleDeps = {}): Promise<void> {
  try {
    const now = (deps.now ?? Date.now)();
    switch (event.type) {
      case "customer.subscription.created": {
        const sub = event.data.object;
        if (sub.status !== "trialing" && !sub.trial_start) return;
        const userId = sub.metadata?.user_id || (await userOf(db, sub.customer));
        if (userId) await recordFunnel("trial_start", userId, {}, deps.funnel);
        return;
      }
      case "invoice.paid": {
        const inv = event.data.object;
        if (!(inv.amount_paid > 0)) return;   // the $0 invoice that opens a trial is not a charge
        const userId = await userOf(db, inv.customer);
        if (!userId) return;
        await recordFunnel("paid", userId, {}, deps.funnel);
        // Receipt for the first charge only (ref ''): Stripe's invoices and the Customer Portal cover renewals.
        const mail = mailOf(deps);
        const to = mail && (await db.emailFor(userId));
        if (mail && to) {
          const paidSec = inv.status_transitions?.paid_at ?? inv.created ?? Math.floor(now / 1000);
          await sendOnce(mail, userId, "receipt", "", async () => receiptEmail({
            to, plan: planName((await mail.subOf(userId))?.tier), cents: inv.amount_paid, currency: inv.currency,
            paidAt: paidSec * 1000, invoice: inv.number ?? null,
          }));
        }
        return;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const ended = event.type === "customer.subscription.deleted";
        const prev = ((event.data as { previous_attributes?: Partial<Stripe.Subscription> }).previous_attributes ?? {}) as Partial<Stripe.Subscription>;
        // Set to cancel by this update: cancel_at_period_end (or a cancel_at date) just turned on.
        const turnedOn = (sub.cancel_at_period_end && prev.cancel_at_period_end === false) || (!!sub.cancel_at && "cancel_at" in prev && !prev.cancel_at);
        if (!ended && !turnedOn) return;
        const userId = sub.metadata?.user_id || (await userOf(db, sub.customer));
        const mail = mailOf(deps);
        const to = userId && mail ? await db.emailFor(userId) : null;
        if (!userId || !mail || !to) return;
        // An old subscription ending while the user pays for another (Pro → Premium): not a cancellation. The row was
        // just written from the customer's current subscription (lib/billing/stripe.ts currentSubscription).
        const row = await mail.subOf(userId);
        if (row && row.stripe_subscription_id && row.stripe_subscription_id !== sub.id && row.tier && row.tier !== "free") return;
        const { tierFromPrice } = await import("@/lib/billing/stripe");   // lazy: stripe.ts imports this module
        const endSec = ended ? null : sub.cancel_at ?? periodEnd(sub);
        // ref = subscription id: one confirmation per subscription, so "canceled" now and "ended" at period end send one.
        await sendOnce(mail, userId, "cancel", sub.id, () => cancelEmail({
          to, plan: planName(tierFromPrice(sub.items?.data?.[0]?.price)), endsAt: endSec ? endSec * 1000 : null, now,
        }));
        return;
      }
      default:
        return;
    }
  } catch (e) {
    log(`billing hook ${event.type} ${event.id}`, e);
  }
}

function periodEnd(sub: Stripe.Subscription): number | null {
  const loose = sub as unknown as { current_period_end?: number };
  return loose.current_period_end ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end ?? null;
}

async function userOf(db: Pick<BillingDb, "userForCustomer">, customer: string | { id: string } | null | undefined) {
  const id = idOf(customer);
  return id ? db.userForCustomer(id) : null;
}

/** A subscriptions row as the trial cron reads it. */
export interface TrialRow {
  user_id: string; stripe_subscription_id: string | null; tier: string | null; status: string | null;
  current_period_end: string | null; cancel_at_period_end: boolean | null;
}

/** Trials the reminder is due for: trialing, ending within TRIAL_NOTICE_MS and not yet ended, not already set to cancel. */
export function trialsDue(rows: TrialRow[], now: number): TrialRow[] {
  return rows.filter((r) => {
    const end = Date.parse(r.current_period_end ?? "");
    return r.status === "trialing" && !!r.stripe_subscription_id && !r.cancel_at_period_end
      && Number.isFinite(end) && end > now && end - now <= TRIAL_NOTICE_MS;
  });
}

/** Daily (vercel.json → /api/lifecycle/run): "your trial ends in 2 days, here's how to cancel". */
export async function runTrialReminders(
  source: { trialing: () => Promise<TrialRow[]>; emailFor: (userId: string) => Promise<string | null> },
  mail: MailDeps, now = Date.now(),
): Promise<{ due: number; sent: number; failed: number }> {
  const due = trialsDue(await source.trialing(), now);
  let sent = 0, failed = 0;
  for (const r of due) {
    try {
      const to = await source.emailFor(r.user_id);
      if (!to) continue;
      const endsAt = Date.parse(r.current_period_end!);
      if (await sendOnce(mail, r.user_id, "trial_ending", r.stripe_subscription_id!, () => trialEndingEmail({ to, plan: planName(r.tier), endsAt, now }))) sent++;
    } catch (e) {
      failed++;
      log("trial reminder", e);
    }
  }
  return { due: due.length, sent, failed };
}
