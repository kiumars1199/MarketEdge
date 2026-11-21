// System health (T-141): data freshness and source, engine headline, /api/health, Stripe webhooks, the last
// alert run, and env-driven flags. Shows only "configured / not configured", never a key or URL.
import { bestBetsCount } from "@/lib/data/counts";
import { day } from "@/components/admin/Stats";
import { Count } from "@/components/kit";
import { adminEmails } from "@/lib/admin/core";
import { healthReport } from "@/lib/health";   // the full report; public /api/health is {ok} only (RT-14)
import { requireAdmin } from "@/lib/admin/server";
import { DATA_SOURCE, DEMO_MODE } from "@/lib/config";
import { chosenResult } from "@/lib/data/model";
import { getStore } from "@/lib/data/store";
import { ago, exactCount, utcWhen as when } from "@/lib/format";
import { fmtRecord } from "@/lib/trackRecord";

export const dynamic = "force-dynamic";

interface Health { ok: boolean; db: string; stripe: string; ratelimit: string; data: { age_minutes?: number; stale?: boolean; source?: string; error?: string } }
interface AlertRun { at: string; ran: boolean; users?: number; rules?: number; events?: number; emails?: number; webhooks?: number; errors?: number; error?: string; reason?: string }

const yes = (v: unknown) => (v ? "Configured" : "Not configured");

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <dl className="overflow-hidden rounded-card border border-border bg-surface">{children}</dl>
    </section>
  );
}
function Item({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 md:px-5">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className={`text-right text-sm tabular-nums ${tone === "warn" ? "text-warning" : tone === "ok" ? "text-accent-soft" : "text-soft"}`}>{v}</dd>
    </div>
  );
}

export default async function Page() {
  const { db } = await requireAdmin();
  const [store, h, events, run] = await Promise.all([
    getStore().catch(() => null),
    healthReport() as Promise<Health>,
    db.from("stripe_events").select("id, type, processed_at").order("processed_at", { ascending: false }).limit(50),
    db.from("app_settings").select("value").eq("key", "alerts_last_run").maybeSingle(),
  ]);
  const result = store ? chosenResult(store.backtest) : null;
  const rec = fmtRecord(result?.taker);
  const last = run.data?.value as AlertRun | undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Data">
          <Item k="Last scan" v={store ? `${ago(store.meta.scanned_at)}` : "No data loaded"} tone={!store || h.data.stale ? "warn" : undefined} />
          <Item k="Source in use" v={store?.source ?? DATA_SOURCE} />
          <Item k="Markets scanned" v={<Count n={store?.meta.markets_scanned} />} />
          <Item k="Best bets" v={<Count n={store ? bestBetsCount(store).total : undefined} />} />
          <Item k="Events" v={<Count n={store?.byEvent.size} />} />
        </Panel>
        <Panel title="Engine (chosen backtest)">
          <Item k="Average return (ROI)" v={rec.ret} />
          <Item k="Confidence (t-stat)" v={rec.t} />
          <Item k="Bets tested · events" v={`${rec.bets} · ${rec.events}`} />
          <Item k="Weekly folds" v={exactCount((result?.folds ?? []).length)} />
          <Item k="Model fitted" v={store ? ago(store.model.fitted_at) : "—"} />
        </Panel>
        <Panel title="Services (/api/health)">
          <Item k="Overall" v={h.ok ? "Healthy" : "Degraded"} tone={h.ok ? "ok" : "warn"} />
          <Item k="Database" v={h.db} tone={h.db === "unreachable" ? "warn" : undefined} />
          <Item k="Rate limiting" v={h.ratelimit === "on" ? "On" : "Off"} tone={h.ratelimit === "on" ? undefined : "warn"} />
          <Item k="Stripe" v={yes(process.env.STRIPE_SECRET_KEY)} />
          <Item k="Resend (email)" v={yes(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)} />
          <Item k="Sentry" v={yes(process.env.NEXT_PUBLIC_SENTRY_DSN)} />
          <Item k="PostHog" v={yes(process.env.NEXT_PUBLIC_POSTHOG_KEY)} />
        </Panel>
        <Panel title="Flags (env)">
          <Item k="DEMO_MODE" v={DEMO_MODE ? "On" : "Off"} tone={DEMO_MODE ? "warn" : undefined} />
          <Item k="DATA_SOURCE" v={DATA_SOURCE} />
          <Item k="KALSHI_TRADING_ENV" v={process.env.KALSHI_TRADING_ENV || "Off"} />
          <Item k="KALSHI_DATA_PERMISSION" v={process.env.KALSHI_DATA_PERMISSION === "true" ? "On" : "Off"} />
          <Item k="ADMIN_EMAILS" v={(() => { const n = adminEmails(process.env.ADMIN_EMAILS).length; return `${exactCount(n)} ${n === 1 ? "admin" : "admins"}`; })()} />
        </Panel>
      </div>

      <Panel title="Last alert run">
        {last ? (
          <>
            <Item k="When" v={when(last.at)} />
            <Item k="Result" v={last.ran ? `${exactCount(last.events)} alerts · ${exactCount(last.emails)} emails · ${exactCount(last.webhooks)} webhooks` : last.reason ?? last.error ?? "Didn't run"} tone={last.ran ? undefined : "warn"} />
            <Item k="Delivery errors" v={exactCount(last.errors ?? (last.error ? 1 : 0))} tone={(last.errors ?? 0) > 0 || last.error ? "warn" : undefined} />
          </>
        ) : <Item k="When" v="No server run recorded yet" />}
      </Panel>

      <section aria-labelledby="wh-h" className="flex flex-col gap-2.5">
        <h2 id="wh-h" className="text-sm font-medium text-muted">Stripe webhook events (last 50, processed)</h2>
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-border">
              <th scope="col" className="px-4 py-3 font-medium">Type</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Processed</th>
            </tr></thead>
            <tbody>
              {(events.data ?? []).map((e) => (
                <tr key={e.id} className="border-t border-border first:border-t-0">
                  <td className="px-4 py-2.5 font-mono text-xs">{e.type}</td>
                  <td className="px-4 py-2.5 text-soft">processed</td>
                  <td className="px-4 py-2.5 tabular-nums text-soft">{e.processed_at ? `${day(e.processed_at)} · ${new Date(e.processed_at).toISOString().slice(11, 16)} UTC` : "—"}</td>
                </tr>
              ))}
              {!events.data?.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted">No webhook events recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
