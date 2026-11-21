// Admin overview (T-141): users, plans, revenue estimate, activity. Counts only; nothing per-bet or per-user ranked.
import { SignupsChart } from "@/components/admin/Controls";
import { Stats } from "@/components/admin/Stats";
import { requireAdmin } from "@/lib/admin/server";
import { exactCount, money } from "@/lib/format";
import { SITE } from "@/lib/site";
import { tradingEnv } from "@/lib/trade/server";

export const dynamic = "force-dynamic";

interface Overview {
  users_total: number;
  tiers: { free: number; pro: number; premium: number; trialing: number; comped: number };
  paying: { pro: number; premium: number };
  canceled_this_month: number; trials_started: number; trials_converted: number;
  active_24h: number; active_7d: number; alerts_24h: number; paper_orders: number;
  signups: { day: string; n: number }[];
}

/** T-276 activation (20261119000500_first_bets_visit.sql): sign-ups and first Best bets visits per day. */
interface Activation {
  days: { day: string; signups: number; first_bets: number }[];
  signups_7d: number; first_bets_7d: number; first_bets_total: number;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

export default async function Page() {
  const { db } = await requireAdmin();
  const [{ data, error }, act] = await Promise.all([db.rpc("admin_overview"), db.rpc("admin_activation")]);
  if (error || !data) {
    return <p role="alert" className="rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm">Couldn&apos;t load the overview. Has the admin migration (supabase/migrations/20261118000000_admin.sql) been applied?</p>;
  }
  const o = data as Overview;
  const payingTotal = o.paying.pro + o.paying.premium;
  const mrr = o.paying.pro * SITE.prices.pro_monthly + o.paying.premium * SITE.prices.premium_monthly;
  const signups = o.signups.map((d) => ({ ...d, label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) }));
  const last30 = signups.reduce((n, d) => n + d.n, 0);
  const a = act.error ? null : (act.data as Activation | null);   // null until the owner applies the migration

  return (
    <div className="flex flex-col gap-8">
      <Stats label="Users" items={[
        { k: "Total users", v: exactCount(o.users_total), testId: "admin-users-total" },
        { k: "Free", v: exactCount(o.tiers.free) },
        { k: "Pro", v: exactCount(o.tiers.pro), sub: o.tiers.comped ? `${exactCount(o.tiers.comped)} comped across plans` : undefined },
        { k: "Premium", v: exactCount(o.tiers.premium), sub: `${exactCount(o.tiers.trialing)} on a free trial` },
      ]} />

      <section aria-labelledby="signups-h" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="signups-h" className="text-sm font-medium text-muted">Sign-ups per day, last 30 days</h2>
          <p className="text-sm text-soft"><span className="tabular-nums">{exactCount(last30)}</span> in 30 days</p>
        </div>
        <div className="rounded-card border border-border bg-surface px-2 pb-2 pt-4 md:px-4">
          <SignupsChart rows={signups} />
        </div>
      </section>

      {a ? (
        <section aria-labelledby="activation-h" className="flex flex-col gap-2.5" data-testid="admin-activation">
          <Stats label="Activation" items={[
            { k: "Sign-ups, last 7 days", v: exactCount(a.signups_7d), testId: "admin-signups-7d" },
            { k: "First Best bets visits, last 7 days", v: exactCount(a.first_bets_7d), title: "Accounts whose first signed-in Best bets page load was in the window", testId: "admin-first-bets-7d" },
            { k: "Reached Best bets, all time", v: exactCount(a.first_bets_total), sub: `${pct(a.first_bets_total, o.users_total)} of all users` },
            { k: "Active, last 7 days", v: exactCount(o.active_7d), title: "Distinct users with a session refreshed in the window" },
          ]} />
          <h2 id="activation-h" className="sr-only">Sign-ups and first Best bets visits per day</h2>
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Last 14 days, newest first</caption>
              <thead className="text-left text-muted">
                <tr><th scope="col" className="px-4 py-2 font-medium">Day (UTC)</th><th scope="col" className="px-4 py-2 font-medium">Sign-ups</th><th scope="col" className="px-4 py-2 font-medium">First Best bets visits</th></tr>
              </thead>
              <tbody>
                {a.days.slice(-14).reverse().map((d) => (
                  <tr key={d.day} className="border-t border-border">
                    <td className="px-4 py-2">{d.day}</td><td className="px-4 py-2">{exactCount(d.signups)}</td><td className="px-4 py-2">{exactCount(d.first_bets)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted" data-testid="admin-activation-missing">
          Activation counts (first Best bets visits) need supabase/migrations/20261119000500_first_bets_visit.sql.
        </p>
      )}

      <Stats label="Revenue (Stripe subscriptions)" items={[
        { k: "Paying subscribers", v: exactCount(payingTotal), sub: `${exactCount(o.paying.pro)} Pro · ${exactCount(o.paying.premium)} Premium` },
        { k: "MRR (estimate)", v: money(mrr), title: "Paying subscribers × monthly list price. Annual plans and discounts aren't separated; Stripe has the exact figure.", sub: "at monthly list price" },
        { k: "Churn this month", v: pct(o.canceled_this_month, payingTotal + o.canceled_this_month), sub: `${exactCount(o.canceled_this_month)} canceled since the 1st` },
        { k: "Trial conversion", v: pct(o.trials_converted, o.trials_started), sub: `${exactCount(o.trials_converted)} of ${exactCount(o.trials_started)} trials now paying` },
      ]} />

      <Stats label="Activity" items={[
        { k: "Active, last 24 h", v: exactCount(o.active_24h), title: "Distinct users with a session refreshed in the window" },
        { k: "Active, last 7 days", v: exactCount(o.active_7d), title: "Distinct users with a session refreshed in the window" },
        { k: "Alerts sent, 24 h", v: exactCount(o.alerts_24h) },
        ...(tradingEnv() ? [{ k: "Paper-trading orders", v: exactCount(o.paper_orders), sub: "logged to My bets, all time" }] : []),
      ]} />
    </div>
  );
}
