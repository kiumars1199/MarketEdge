// Status (T-29, F-24): when each part of the data was last refreshed, and what it holds.
import { DATA_SOURCE } from "@/lib/config";
import { zonedTime } from "@/lib/zone";
import { requestZone } from "@/lib/zone-server";
import { getTier } from "@/lib/auth/server";
import { can } from "@/lib/entitlements";
import { pendingLine } from "@/lib/data/respond";
import { getStoreFor, type Store } from "@/lib/data/store";
import { bestBetsCount, settledCount } from "@/lib/data/counts";
import { Count } from "@/components/kit";
import { PendingState } from "@/components/screener/States";
import { DASH, delayWords, formatCount } from "@/lib/format";
import { REFRESH_WORDS, freshness, scanLate } from "@/lib/freshness";
import { Ago } from "@/components/clock";
import { delayMin } from "@/lib/settings-core";
import { SITE } from "@/lib/site";
import { ScanStamp } from "@/lib/scanClock";

export const metadata = { title: "Status", description: "When Kismet data last refreshed." };
export const dynamic = "force-dynamic";

const n = (x: number | null | undefined) => formatCount(x);   // docs/18 §4
/** In the visitor's zone (T-288), else UTC; always named. */
const when = (unix: unknown, zone: string | null) =>
  typeof unix === "number" ? zonedTime(unix, zone, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }, "UTC") : DASH;
const VERDICT_LABEL: Record<string, string> = { "worth it": "Fair price", thin: "Spread eats most of it" };

export default async function Page() {
  // RT3-07: the scan this tier is served (Free / signed-out: the delayed copy), like /api/meta: its time and counts.
  const [tier, zone] = await Promise.all([getTier(), requestZone()]);
  let s: Store;
  try {
    s = await getStoreFor(tier);
  } catch (e) {
    return <div className="mx-auto w-full max-w-[720px] pt-4 md:pt-10"><PendingState line={pendingLine(e)} /></div>;
  }
  const delay = delayMin(tier);
  const { meta, model, backtest, ledgerSummary: l } = s;
  const level = freshness(meta.scanned_at);
  const late = scanLate(meta.scanned_at, delay);   // QA-A #2: "current" only while the scan is as new as the cadence allows
  // T-288: the same count as Best bets and the landing (lib/data/counts.ts): open best-tier bets that pass the price
  // check, at the default chance floor. Its price-check sections below add up to it. (meta.flags counted both tiers.)
  // QA-A #26/#57: counted the way this tier's Best bets list counts (Free widens past US when it holds under 10).
  const best = bestBetsCount(s, { free: !can(tier, "live_data") });
  // QA-A #49/#63: each bet once, the same base as /track-record (was every logged row: "1.9K settled" vs "1,155")
  const rec = settledCount(l);
  const times: [string, unknown, string][] = [
    ["Last market scan", meta.scanned_at, "Prices, win chances and best bets"],
    ["Last model fit", model.fitted_at, "Win-chance curves from settled markets"],
    ["Last backtest", backtest.ran_at, "The test behind Results"],
    ["Live record updated", l?.updated_at, "Best bets graded after they settle"],
  ];

  return (
    <article className="mx-auto flex max-w-4xl flex-col gap-10 pb-8">
      <ScanStamp at={meta.scanned_at} />
      <header className="flex flex-col gap-3">
        <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">Status</h1>
        <p className={`flex items-center gap-2 text-[15px] ${level === "fresh" ? "text-soft" : level === "amber" ? "text-warning" : "text-negative"}`}>
          <span className={`size-2 rounded-full ${level === "fresh" ? "bg-accent" : level === "amber" ? "bg-warning" : "bg-negative"}`} aria-hidden="true" />
          {level !== "fresh"
            ? <>Data may be stale. Last scan <Ago at={meta.scanned_at} />; prices normally refresh {REFRESH_WORDS}.</>
            : late
              ? <>Last scan <Ago at={meta.scanned_at} />. Scans normally run {REFRESH_WORDS}, so the next one is late.</>
              : <>Data is current. Last scan <Ago at={meta.scanned_at} />. Scans run {REFRESH_WORDS}.</>}
        </p>
        {delay > 0 && <p className="text-sm text-muted">On the Free plan and when signed out, you see each scan {delayWords(delay)} after it runs: the scan above is the one you see. Paid plans see the newest scan.</p>}
      </header>

      <section aria-labelledby="times-h" className="flex flex-col gap-3">
        <h2 id="times-h" className="text-xl font-semibold">Last updated</h2>
        <ul className="overflow-hidden rounded-card border border-border bg-surface">
          {times.map(([label, t, what]) => (
            <li key={label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 md:px-5">
              <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{what}</span></span>
              <span className="tabular-nums text-soft" title={typeof t === "number" ? undefined : "not available"}>
                {when(t, zone)}{typeof t === "number" && <span className="text-muted"> · <Ago at={t} /></span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="counts-h" className="flex flex-col gap-3">
        <h2 id="counts-h" className="text-xl font-semibold">What&apos;s in the data</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border md:grid-cols-4">
          <Stat label="Markets scanned" value={n(meta.markets_scanned)} />
          <Stat label="Best bets" value={<Count n={best.total} />} testId="status-best-bets" />
          <Stat label="Events" value={n(s.byEvent.size)} />
          <Stat label="Live record" value={rec ? `${n(rec.logged)} logged` : DASH} testId="status-record"
            sub={rec ? `${n(rec.settled)} settled · ${n(rec.won)} won · ${n(rec.lost)} lost${rec.void ? ` · ${n(rec.void)} void` : ""}` : "No live record yet"} />
        </dl>
      </section>

      <section aria-labelledby="checks-h" className="flex flex-col gap-3">
        <h2 id="checks-h" className="text-xl font-semibold">Price checks on best bets</h2>
        <ul className="overflow-hidden rounded-card border border-border bg-surface" data-testid="status-sections">
          {Object.entries(best.sections).map(([v, c]) => (
            <li key={v} className="flex justify-between border-t border-border px-4 py-3 first:border-t-0 md:px-5">
              <span>{VERDICT_LABEL[v] ?? v}</span><span className="tabular-nums text-soft" data-section={v}><Count n={c} /></span>
            </li>
          ))}
          <li className="flex justify-between border-t border-border px-4 py-3 font-medium md:px-5">
            <span>Best bets</span><span className="tabular-nums"><Count n={best.total} /></span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="source-h" className="flex flex-col gap-2 text-sm text-soft">
        <h2 id="source-h" className="text-xl font-semibold text-text">Data source</h2>
        <p>
          Venue: {meta.platform === "polymarket" ? "Polymarket" : "Kalshi"} public market data · {SITE.name} engine ·
          read from {DATA_SOURCE === "local" ? "local files" : "the published scan data"}.
        </p>
      </section>
    </article>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: React.ReactNode; sub?: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-4 md:p-5" data-testid={testId}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-heading text-2xl font-bold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}
