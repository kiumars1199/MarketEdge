// Landing at /about (T-28, F-20; moved from / by T-70, docs/13). Live counters and preview cards come from the store; tiles from backtest.json.
import { bestBetsCount } from "@/lib/data/counts";
import { can } from "@/lib/entitlements";
import { REFRESH_WORDS } from "@/lib/freshness";
import Link from "next/link";
import { Faq, Plans } from "@/components/pricing/Plans";
import { Tiles } from "@/components/results/Tiles";
import { ProofLine } from "@/components/results/ProofLine";
import { HIT_RATE_VS_PROFIT, SAME_FOR_EVERYONE, hitRateLive, siteProof, withLiveHitRate } from "@/lib/proof";
import { planCtx } from "@/lib/billing/planCtx";
import { getSettings } from "@/lib/settings";
import { chosenResult } from "@/lib/data/model";
import { getMe } from "@/lib/auth/server";
import type { Store } from "@/lib/data/store";
import { topOrStore } from "@/lib/data/top";
import { pendingLine } from "@/lib/data/respond";
import { PendingState } from "@/components/screener/States";
import { RETURN_HELP, formatCount } from "@/lib/format";
import { BetCard } from "@/components/market/BetCard";
import { RETURN_HELP_ONE } from "@/lib/betFigures";
import { tiles } from "@/lib/trackRecord";
import { allRows, topByReturn } from "@/lib/topBets";

export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts); signed in: app/signed-in/*
export const revalidate = 300;
export const metadata = { title: "How it works" };

const n = (x: number | undefined) => formatCount(x);   // docs/18 §4

const STEPS: [string, string][] = [
  ["Read the price", `A Yes priced at 68% means the market gives it a 68% chance, and it pays about 1.47x. We check every open Polymarket market, ${REFRESH_WORDS}.`],
  ["Check the history", "How often did bets like this one win? Same sport or topic, same kind of bet, same time before close, across thousands of settled markets."],
  ["Show the gap", "When bets like it won more often than the price says, after the fee and what you'd really pay, it's a best bet. You decide what to do with it."],
];

const FAQ: { q: string; a: React.ReactNode; id?: string; open?: boolean }[] = [
  { q: "What is estimated return?", a: <>{RETURN_HELP_ONE} Example: a 90% chance at a 1.39x payout is 0.90 × 1.39 − 1 ≈ +25%, about +$2.50 per $10 bet on average. It is not a promise: any single bet can lose.</> },
  { id: "returns", open: true, q: "Why do I see more than one return number?", a: <>
    A bet shows one return on its card: the <strong>estimated return</strong> at today&apos;s price, after the fee. The same figure appears in &ldquo;Why this bet?&rdquo;, the details and the table.
    {" "}&ldquo;Why this bet?&rdquo; adds two other numbers, each labelled with how many bets it counts: <strong>similar past bets in testing</strong> (best bets at the same payout, tested week by week on markets the estimate had never seen) and the <strong>live record so far</strong> (every best bet since launch, all payouts together).
    {" "}They answer different questions, so they can differ; when the tested group has too few bets, it says so instead of showing a number. All of them are past results, not a promise. </> },
  { q: "Do best bets usually win?", a: HIT_RATE_VS_PROFIT },
  { q: "Is this betting advice?", a: `No. It's market analytics, based on how past markets settled. ${SAME_FOR_EVERYONE} Any single bet can lose.` },
  { q: "How is it tested?", a: <>Week by week, on markets the model had never seen: each week it only knows what happened before, and we check how its best bets settled. Losing weeks and limits are shown on <Link href="/track-record" className="text-accent-hover underline-offset-4 hover:underline">Results</Link>.</> },
  { q: "Which markets do you cover?", a: "Polymarket today. Kalshi later, once we have their permission to use the data." },
];

export default async function Page() {
  const me = await getMe();
  const tier = me.tier;   // landing preview: same tier shaping and Free delay as the API (docs/15)
  let store: Store;
  try {
    store = await topOrStore(tier);   // T-295: top.json (every best bet) when it can serve this tier, else the full store
  } catch (e) {
    return <div className="mx-auto w-full max-w-[720px] pt-4 md:pt-10"><PendingState line={pendingLine(e)} /></div>;
  }
  // T-291 #13: the top 3 by the return each card shows (the shared cardReturn), across every matching bet
  const top = topByReturn(allRows(store, { view: "flags", verdicts: ["worth it"] }), 3, tier);
  const bestCount = bestBetsCount(store, { free: !can(tier, "live_data") }).total;   // T-288 + QA-A #26: the one count, as this tier's list counts
  const tested = chosenResult(store.backtest)?.taker;

  return (
    <article className="mx-auto flex max-w-6xl flex-col gap-20 pb-8 md:gap-24">
      <section className="grid items-end gap-10 pt-4 md:pt-10 lg:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col gap-6">
          <h1 className="text-[44px] font-bold leading-[1.02] tracking-[-0.03em] md:text-[64px]">Same payout. Different odds.</h1>
          <p className="max-w-xl text-[17px] leading-relaxed text-soft">
            Every Polymarket bet pays $1 if it hits. Some cost less than how often bets like them have actually won.
            Kismet finds those, after the fee and the price you&apos;d really pay.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/markets" className="flex min-h-12 items-center rounded-input bg-accent px-6 font-semibold text-on-accent hover:bg-accent-hover">Open screener</Link>
            <Link href="/" className="flex min-h-12 items-center rounded-input border border-border bg-muted-bg px-5 font-medium hover:border-accent-border">See best bets</Link>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-4 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <Counter label="markets checked" value={n(store.meta.markets_scanned)} />
          <Counter label="best bets right now" value={n(bestCount)} accent />
          <Counter label="past bets tested" value={n(tested?.flags)} />
        </dl>
      </section>

      <section aria-labelledby="how-h" className="flex flex-col gap-6">
        <h2 id="how-h" className="text-[28px] font-semibold tracking-[-0.01em]">How it works</h2>
        <ol className="grid gap-6 md:grid-cols-3 md:gap-8">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="font-heading text-sm font-semibold text-accent">Step {i + 1}</span>
              <h3 className="text-lg font-semibold">{t}</h3>
              <p className="text-sm leading-relaxed text-soft">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="now-h" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="now-h" className="text-[28px] font-semibold tracking-[-0.01em]">Best bets right now</h2>
            <p className="mt-1 text-sm text-muted" title={RETURN_HELP}>Top 3 by estimated return, among bets with at least a 40% chance. Live from the last scan.</p>
          </div>
          <Link href="/" className="flex min-h-11 items-center text-accent-hover hover:underline">All {n(bestCount)} best bets</Link>
        </div>
        {top.length ? (
          <div className="grid gap-3.5 md:grid-cols-3">
            {top.map((r) => <BetCard key={r.market.id} r={{ market: r.market, side: r.side }} />)}
          </div>
        ) : (
          <p className="rounded-card border border-border bg-surface p-6 text-soft">No best bets in the last scan. The next scan may find some.</p>
        )}
      </section>

      <section aria-labelledby="results-h" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="results-h" className="text-[28px] font-semibold tracking-[-0.01em]">How they did in testing</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">Best bets on past weeks the model had never seen, compared with buying every bet. Historical results, not a promise.</p>
          </div>
          <Link href="/track-record" className="flex min-h-11 items-center text-accent-hover hover:underline">Full results and limits</Link>
        </div>
        <Tiles tiles={tiles(store.backtest).filter((t) => t.key !== "cents" && t.key !== "t")} /* cents + t-stat stay on Results */ />
        <ProofLine p={siteProof({ backtest: store.backtest, ledger: store.ledgerSummary, since: store.ledgerSince })} className="text-[15px] leading-relaxed text-soft" />
      </section>

      <section aria-labelledby="plans-h" className="flex flex-col gap-6">
        <h2 id="plans-h" className="text-[28px] font-semibold tracking-[-0.01em]">Plans</h2>
        <Plans delay={(await getSettings()).free_delay_min} ctx={await planCtx(me)} />
        <Link href="/pricing" className="flex min-h-11 w-fit items-center text-accent-hover hover:underline">Compare every feature</Link>
      </section>

      <section aria-labelledby="faq-h" className="flex flex-col gap-6">
        <h2 id="faq-h" className="text-[28px] font-semibold tracking-[-0.01em]">Questions</h2>
        <Faq items={withLiveHitRate(FAQ, hitRateLive(store.ledgerSummary))} />
      </section>
    </article>
  );
}

function Counter({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-heading text-[28px] font-bold leading-tight tracking-[-0.02em] md:text-[34px] ${accent ? "text-accent" : ""}`}>{value}</dd>
    </div>
  );
}

