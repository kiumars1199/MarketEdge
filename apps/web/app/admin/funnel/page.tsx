// Admin funnel (T-299, docs/OVERHAUL.md §F3): daily counts per funnel step and step-to-step conversion, last 30 days.
// Source: Supabase funnel_events (supabase/migrations/20261120000200_funnel_events.sql), not PostHog's API. PostHog runs
// cookieless with no person profiles (lib/telemetry.ts), so it can't tie a sign-up to a later payment or keep "first"
// steps to once per person; the table can, and it's needed for that dedupe anyway. PostHog still gets every counted step.
import { Stats } from "@/components/admin/Stats";
import { requireAdmin } from "@/lib/admin/server";
import { exactCount } from "@/lib/format";
import { FUNNEL_STEPS, STEP_LABELS, funnelReport, type FunnelRow } from "@/lib/funnel";

export const dynamic = "force-dynamic";

const DAYS = 30;
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

export default async function Page() {
  const { db } = await requireAdmin();
  const today = new Date().toISOString().slice(0, 10);
  let rows: FunnelRow[] | null = null;
  let direct = false;
  const rpc = await db.rpc("admin_funnel", { p_days: DAYS });
  if (!rpc.error && Array.isArray(rpc.data)) rows = rpc.data as FunnelRow[];
  else {
    // Without the function (or the e2e mock), count the rows directly. Capped by PostgREST's row limit: flagged below.
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    const raw = await db.from("funnel_events").select("event, day").gte("day", since).limit(10_000);
    if (!raw.error && raw.data) {
      direct = true;
      const n = new Map<string, number>();
      for (const r of raw.data as { event: string; day: string }[]) n.set(`${r.day}|${r.event}`, (n.get(`${r.day}|${r.event}`) ?? 0) + 1);
      rows = [...n].map(([k, v]) => { const [day, event] = k.split("|") as [string, string]; return { day, event, n: v }; });
    }
  }
  if (!rows) {
    return <p role="alert" className="rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm">Couldn&apos;t load the funnel. Has supabase/migrations/20261120000200_funnel_events.sql been applied?</p>;
  }
  const r = funnelReport(rows, today, DAYS);
  const t = r.totals;

  return (
    <div className="flex flex-col gap-8" data-testid="admin-funnel">
      <Stats label={`Funnel, last ${DAYS} days`} items={[
        { k: "Landing page views", v: exactCount(t.landing_view), testId: "funnel-total-landing_view" },
        { k: "Signed up", v: exactCount(t.signup_done), sub: `${pct(t.landing_view ? t.signup_done / t.landing_view : null)} of landing views`, testId: "funnel-total-signup_done" },
        { k: "Trials started", v: exactCount(t.trial_start), testId: "funnel-total-trial_start" },
        { k: "Paid", v: exactCount(t.paid), sub: `${pct(t.signup_done ? t.paid / t.signup_done : null)} of sign-ups`, testId: "funnel-total-paid" },
      ]} />

      <section aria-labelledby="steps-h" className="flex flex-col gap-2.5">
        <h2 id="steps-h" className="text-sm font-medium text-muted">Step to step</h2>
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-muted">
              <tr><th scope="col" className="px-4 py-2 font-medium">Step</th><th scope="col" className="px-4 py-2 font-medium">{DAYS} days</th><th scope="col" className="px-4 py-2 font-medium">From the step above</th></tr>
            </thead>
            <tbody>
              {FUNNEL_STEPS.map((s) => (
                <tr key={s} className="border-t border-border" data-testid={`funnel-step-${s}`}>
                  <th scope="row" className="px-4 py-2 text-left font-normal">{STEP_LABELS[s]}</th>
                  <td className="px-4 py-2">{exactCount(t[s])}</td>
                  <td className="px-4 py-2">{pct(r.conversion[s])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Signed-out steps (landing view, sign-up started, plans page) count visits. Signed-in steps count people: each
          fires once per account, ever. So the sign-up row compares people with visits: read it as a rate, not a cohort.
          {direct && " Counted from the raw rows (the admin_funnel function isn't there); capped at 10,000 rows."}
        </p>
      </section>

      <section aria-labelledby="daily-h" className="flex flex-col gap-2.5">
        <h2 id="daily-h" className="text-sm font-medium text-muted">Per day (UTC), last 14 days, newest first</h2>
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-muted">
              <tr>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Day</th>
                {FUNNEL_STEPS.map((s) => <th key={s} scope="col" className="px-3 py-2 font-medium">{STEP_LABELS[s]}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.days.slice(-14).reverse().map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2">{d.day}</td>
                  {FUNNEL_STEPS.map((s) => <td key={s} className="px-3 py-2">{exactCount(d.counts[s])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
