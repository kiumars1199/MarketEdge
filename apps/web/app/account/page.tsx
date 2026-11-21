// Account (docs/14 §1, T-47): email, plan, billing portal, JSON export, sign out (everywhere), delete.
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountActions, CheckoutStatus, DeleteAccount } from "@/components/auth/AccountActions";
import { PageTitle, card } from "@/components/kit";
import { McpSetup } from "@/components/account/McpSetup";
import { siteUrl } from "@/lib/site";
import { isAdminEmail } from "@/lib/admin/core";
import { accountsOffNote, authEnabled, getMe } from "@/lib/auth/server";
import { DEMO_MODE } from "@/lib/config";
import { billingMode } from "@/lib/billing/stripe";

export const metadata = { title: "Account", robots: { index: false } };
export const dynamic = "force-dynamic";

const PLAN = { free: "Free", pro: "Pro", premium: "Premium" } as const;
const STATUS: Record<string, string> = {
  trialing: "Free trial", active: "Active", past_due: "Payment failed: update your card", canceled: "Canceled",
  unpaid: "Unpaid", incomplete: "Waiting for payment",
};
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null);

export default async function Page({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  if (!authEnabled()) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageTitle title="Account" sub={accountsOffNote()} />
        <Link href="/settings" className="inline-flex min-h-11 w-fit items-center text-accent-hover underline-offset-4 hover:underline">Open settings</Link>
      </div>
    );
  }
  const me = await getMe();
  if (!me.user) redirect("/signup?next=/account");
  const renew = date(me.current_period_end);
  const billing = billingMode() !== null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageTitle title="Account">
        {/* #21: settings (display, sizing, topics, notifications, your data) one tap from the account page */}
        <Link href="/settings" data-testid="account-settings" className="inline-flex min-h-11 items-center rounded-input border border-border bg-muted-bg px-4 text-sm font-medium hover:border-accent-border">Settings</Link>
        <Link href="/?tour=1" className="inline-flex min-h-11 items-center rounded-input px-3 text-sm text-muted hover:text-text">Replay the tour</Link>
        {isAdminEmail(me.user, process.env.ADMIN_EMAILS, DEMO_MODE) && (
          <Link href="/admin" className="inline-flex min-h-11 items-center rounded-input border border-border bg-muted-bg px-4 text-sm font-medium hover:border-accent-border">Admin panel</Link>
        )}
      </PageTitle>
      {checkout === "success" && <CheckoutStatus />}

      <section aria-labelledby="plan-h" className={`${card} flex flex-col gap-4 p-5 md:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="plan-h" className="text-xs font-medium text-muted">Plan</h2>
            <p className="mt-1 font-heading text-[28px] font-bold leading-tight tracking-[-0.02em]" data-testid="plan-name">{PLAN[me.tier]}</p>
            {me.status && <p className={`text-sm ${me.status === "past_due" ? "text-warning" : "text-soft"}`}>{STATUS[me.status] ?? me.status}</p>}
            {renew && (
              <p className="mt-1 text-sm text-muted">
                {me.cancel_at_period_end || me.status === "canceled" ? `Access ends ${renew}` : me.status === "trialing" ? `Trial ends ${renew}` : `Renews ${renew}`}
              </p>
            )}
          </div>
          <AccountActions kind="billing" tier={me.tier} billing={billing} hasCustomer={!!me.status} />
        </div>
      </section>

      <section aria-labelledby="acct-h" className={`${card} flex flex-col gap-4 p-5 md:p-6`}>
        <h2 id="acct-h" className="text-lg font-semibold">Sign-in</h2>
        <p className="text-sm text-soft">Signed in as <span className="font-medium text-text">{me.user.email}</span>, with Google or an email link.</p>
        <p className="text-sm text-muted">An account can be signed in on up to 3 devices. Signing in on a 4th signs out the oldest.</p>
        <AccountActions kind="signout" tier={me.tier} billing={billing} hasCustomer={!!me.status} />
      </section>

      <McpSetup tier={me.tier} url={`${siteUrl()}/api/mcp`} />

      <section aria-labelledby="data-h" className={`${card} flex flex-col gap-4 p-5 md:p-6`}>
        <h2 id="data-h" className="text-lg font-semibold">Your data</h2>
        <p className="text-sm text-soft">Download everything saved to your account: settings, saved views, My list, My bets, alerts and plan status.</p>
        <a href="/api/account/export" download className="inline-flex min-h-11 w-fit items-center rounded-input border border-border bg-muted-bg px-4 text-sm font-medium hover:border-accent-border">
          Download my data (JSON)
        </a>
      </section>

      <section aria-labelledby="del-h" className="flex flex-col gap-4 rounded-card border border-negative/40 p-5 md:p-6">
        <h2 id="del-h" className="text-lg font-semibold">Delete account</h2>
        <p className="text-sm text-soft">
          Cancels any subscription right away and permanently deletes your account and everything saved to it. This can&apos;t be undone.
        </p>
        <DeleteAccount email={me.user.email} />
      </section>
    </div>
  );
}
