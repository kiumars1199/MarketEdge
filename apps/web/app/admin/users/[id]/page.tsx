// One user, for support (T-141): account, plan, sessions and counts of saved items. Counts only: nothing here
// reads, ranks or recommends a user's own bets (CLAUDE.md rule 4).
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompAndLink, Destructive } from "@/components/admin/Controls";
import { day } from "@/components/admin/Stats";
import { requireAdmin } from "@/lib/admin/server";
import { effectiveTier } from "@/lib/entitlements";
import { exactCount } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Detail {
  id: string; email: string; email_confirmed_at: string | null; created_at: string; last_sign_in_at: string | null;
  last_seen_at: string | null; sessions: number; onboarded_at: string | null; accepted_terms_at: string | null;
  tier: string | null; status: string | null; stripe_customer_id: string | null; current_period_end: string | null;
  cancel_at_period_end: boolean | null; trialed_at: string | null; comp_tier: string | null; comp_expires_at: string | null;
  counts: Record<string, number>;
}
const PLAN = { free: "Free", pro: "Pro", premium: "Premium" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNT_LABEL: Record<string, string> = {
  presets: "Saved views", dashboards: "Dashboards", watchlist: "My list", alert_rules: "Alert rules", alert_events: "Alerts received", journal: "My bets entries",
};
/** Stripe dashboard link built from the id (test-mode path when the key is a test key). */
const stripeUrl = (id: string) =>
  /^cus_[A-Za-z0-9]+$/.test(id) ? `https://dashboard.stripe.com/${process.env.STRIPE_SECRET_KEY?.startsWith("sk_test") ? "test/" : ""}customers/${id}` : null;

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 md:px-5">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="text-right text-sm tabular-nums text-soft">{children}</dd>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { db, admin } = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data } = await db.rpc("admin_user_detail", { uid: id });
  if (!data) notFound();
  const u = data as Detail;
  const tier = effectiveTier(u);
  const self = u.id === admin.id;
  const stripe = u.stripe_customer_id ? stripeUrl(u.stripe_customer_id) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/users" className="w-fit text-sm text-muted hover:text-text">← All users</Link>
        <h2 className="break-all font-heading text-2xl font-bold tracking-[-0.02em]">{u.email}</h2>
        <p className="text-sm text-soft">{PLAN[tier]}{u.comp_tier && <> · comped {u.comp_tier}{u.comp_expires_at ? ` until ${day(u.comp_expires_at)}` : ", no end date"}</>}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="acct-h" className="flex flex-col gap-2.5">
          <h3 id="acct-h" className="text-sm font-medium text-muted">Account</h3>
          <dl className="overflow-hidden rounded-card border border-border bg-surface">
            <Item k="Email verified">{u.email_confirmed_at ? day(u.email_confirmed_at) : "Not verified"}</Item>
            <Item k="Signed up">{day(u.created_at)}</Item>
            <Item k="Last sign-in">{day(u.last_sign_in_at)}</Item>
            <Item k="Last seen">{day(u.last_seen_at)}</Item>
            <Item k="Active sessions">{exactCount(u.sessions)}</Item>
            <Item k="Onboarding">{u.onboarded_at ? `Done ${day(u.onboarded_at)}` : "Not finished"}</Item>
            <Item k="18+ and Terms">{u.accepted_terms_at ? `Accepted ${day(u.accepted_terms_at)}` : "Not recorded"}</Item>
          </dl>
        </section>
        <section aria-labelledby="plan-h" className="flex flex-col gap-2.5">
          <h3 id="plan-h" className="text-sm font-medium text-muted">Plan and billing</h3>
          <dl className="overflow-hidden rounded-card border border-border bg-surface">
            <Item k="Paid plan (Stripe)">{PLAN[effectiveTier({ tier: u.tier })]}</Item>
            <Item k="Subscription status">{u.status ?? "—"}{u.cancel_at_period_end ? " · cancels at period end" : ""}</Item>
            <Item k="Period ends">{day(u.current_period_end)}</Item>
            <Item k="Trial started">{day(u.trialed_at)}</Item>
            <Item k="Stripe customer">
              {stripe ? <a href={stripe} target="_blank" rel="noopener noreferrer" className="text-accent-hover underline-offset-4 hover:underline">{u.stripe_customer_id}</a> : "—"}
            </Item>
          </dl>
        </section>
      </div>

      <section aria-labelledby="saved-h" className="flex flex-col gap-2.5">
        <h3 id="saved-h" className="text-sm font-medium text-muted">Saved items (counts)</h3>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(COUNT_LABEL).map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-heading text-xl font-bold tabular-nums">{exactCount(u.counts?.[k] ?? 0)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="act-h" className="flex flex-col gap-2.5">
        <h3 id="act-h" className="text-sm font-medium text-muted">Support actions</h3>
        <div className="flex flex-col gap-5 rounded-card border border-border bg-surface p-4 md:p-5">
          <CompAndLink userId={u.id} email={u.email} comp={u.comp_tier} />
          <div className="flex flex-col gap-3 border-t border-border pt-5">
            {self ? (
              <p className="text-sm text-muted">This is your account. Sign out everywhere and delete live on your Account page, not here.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Destructive userId={u.id} email={u.email} kind="revoke_sessions" />
                <Destructive userId={u.id} email={u.email} kind="delete_user" />
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
