// Pricing (T-28, F-20): tier cards, feature table (docs/01 § Tiers, in display language), FAQ.
import Link from "next/link";
import { Faq, Plans } from "@/components/pricing/Plans";
import { ProofLine } from "@/components/results/ProofLine";
import { getResults } from "@/lib/data/top";
import { HIT_RATE_VS_PROFIT, SAME_FOR_EVERYONE, hitRateLive, siteProof, withLiveHitRate } from "@/lib/proof";
import { planCtx } from "@/lib/billing/planCtx";
import { getSettings } from "@/lib/settings";
import { tradingEnv } from "@/lib/trade/server";
import { behindWords, usd } from "@/lib/format";
import { SITE } from "@/lib/site";
import { CONNECTOR_NAME, connectorAllowance } from "@/lib/connector-plan";

export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts); signed in: app/signed-in/*
export const revalidate = 300;
export const metadata = { title: "Pricing", description: "Free, Pro and Premium plans for Kismet. Start free; paid plans include a 7-day trial and cancel any time.", alternates: { canonical: "/pricing" } };

const up = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const rows = (delay: number): [string, string, string, string][] => [
  ["Best bets", "10 a day, chosen at random", "All", "All"],
  ["Prices", behindWords(delay).replace(/^./, (c) => c.toUpperCase()), "Live", "Live"],
  ["All open markets", "Top 10 rows", "Unlimited", "Unlimited"],
  ["Estimated return on each bet", "As a range (exact on 3 a day)", "Exact", "Exact"],
  ["Combos: 2- and 3-leg bets from Best bets, and your own combo builder", "—", "—", "Yes"],
  ["Kalshi markets: prices, volume and Kalshi Combos", "Yes", "Yes", "Yes"],
  ["Filters", "Topic, sport, price", "All", "All"],
  ["Saved views", "1", "25", "Unlimited"],
  ["Dashboards", "—", "3", "Unlimited"],
  ["My list", "10 bets", "Unlimited", "Unlimited"],
  ["Alerts", "—", "Email (checked once a day) + browser while Kismet is open, 20 rules", "Same as Pro, 100 rules"],
  ["Price check (order book, stake table)", "First share only", "Full", "Full"],
  ["My bets: profit and closing-price tracking", "—", "Yes", "Yes"],
  ["Results and win-chance charts", "Yes", "Yes", "Yes"],
  [CONNECTOR_NAME, "—", up(connectorAllowance("pro")), up(connectorAllowance("premium"))],   // #38/#58/#72: lib/connector-plan.ts
  ["CSV export", "—", "Yes", "Yes"],
];

const PRICING_FAQ: { q: string; a: React.ReactNode }[] = [
  { q: "What happens after the free trial?", a: "Pro and Premium start with 7 days free. Cancel before day 7 and you pay nothing. After that the plan renews monthly or yearly until you cancel." },
  { q: "Can I cancel any time?", a: <>Yes. Open your <Link href="/account" className="text-accent-hover underline-offset-4 hover:underline">account page</Link> and choose <strong>Manage billing or cancel</strong>. You keep your plan until the end of the period you paid for.</> },
  { q: "Do best bets usually win?", a: HIT_RATE_VS_PROFIT },
  { q: "Is this betting advice?", a: `No. Kismet is market analytics, based on how past markets settled. ${SAME_FOR_EVERYONE} Any single bet can lose.` },
  { q: "Do you place bets for me?", a: tradingEnv()
    ? "No. Each market links to Polymarket or Kalshi, where you decide and bet yourself. Paper trading on Kalshi's demo exchange (fake money) sends an order only after you confirm it, every time."
    : "No. Kismet never places orders. Each market links to Polymarket, where you decide and bet yourself." },
  { q: "Who can use it?", a: "Adults 18 and over, where prediction markets are legal for them." },
];

export default async function Page() {
  const [delay, ctx] = await Promise.all([getSettings().then((s) => s.free_delay_min), planCtx()]);   // Free delay from site settings, the one place it is set
  // T-290: the test result never stands alone; no engine output yet → no line (the page still sells the plans)
  const res = await getResults().catch(() => null);
  const proof = res ? siteProof({ backtest: res.backtest, ledger: res.ledgerSummary, since: res.ledgerSince }) : null;
  const faq = withLiveHitRate(PRICING_FAQ, hitRateLive(res?.ledgerSummary));
  return (
    <article className="mx-auto flex max-w-6xl flex-col gap-14 pb-8">
      <header className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">Plans</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Start free. Upgrade when you want live prices, every best bet and alerts. Results are free for everyone, so you can judge
          the method before you pay. <Link href="/track-record" className="text-accent-hover underline-offset-4 hover:underline">See results</Link>
        </p>
        {proof?.test ? <ProofLine p={proof} className="text-[15px] leading-relaxed text-soft" /> : null}
      </header>

      <Plans delay={delay} ctx={ctx} />

      <section aria-labelledby="compare-h" className="flex flex-col gap-4">
        <h2 id="compare-h" className="text-2xl font-semibold">Compare plans</h2>
        <div tabIndex={0} role="region" aria-labelledby="compare-h" className="overflow-x-auto rounded-card border border-border bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="sticky left-0 bg-surface px-4 py-3 font-medium max-sm:w-32 max-sm:px-3 max-sm:shadow-[1px_0_0_var(--border)]">Feature</th>
                <th scope="col" className="px-4 py-3 font-medium">Free</th>
                <th scope="col" className="px-4 py-3 font-medium text-accent-softer">Pro · {usd(SITE.prices.pro_monthly)}</th>
                <th scope="col" className="px-4 py-3 font-medium">Premium · {usd(SITE.prices.premium_monthly)}</th>
              </tr>
            </thead>
            <tbody>
              {rows(delay).map(([f, ...v]) => (
                <tr key={f} className="border-t border-border">
                  <th scope="row" className="sticky left-0 bg-surface px-4 py-2.5 text-left font-normal text-soft max-sm:w-32 max-sm:px-3 max-sm:shadow-[1px_0_0_var(--border)]">{f}</th>
                  {v.map((x, i) => <td key={i} className={`px-4 py-2.5 ${x === "—" ? "text-muted" : ""}`} title={x === "—" ? "not included" : undefined}>{x}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="faq-h" className="flex flex-col gap-4">
        <h2 id="faq-h" className="text-2xl font-semibold">Questions</h2>
        <Faq items={faq} />
      </section>
    </article>
  );
}
