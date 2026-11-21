"use client";
// Tier cards with a monthly/annual toggle (docs/01 § Tiers). Prices come from config/site.json prices_usd (owner, Nov 18:
// Pro $11.99/mo or $99.99/yr, Premium $19.99/mo or $169.99/yr; 7-day trial on both). In demo mode every button opens Best bets, since everything is already unlocked.
// Paid mode: Start trial → /api/stripe/checkout (sign in first); "Coming soon" until Stripe is configured.
// T-291 #12: the server passes what it knows (`ctx`: billing, accounts, signed in, plan), so the first HTML has the
// right button; /api/me takes over once it answers. Before T-291 the buttons read "Coming soon" until /api/me came back.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Tier } from "@/lib/entitlements";
import { useMe } from "@/lib/me";
import { yearlySavings } from "@/lib/billing/plans";
import { track } from "@/lib/telemetry";
import { behindWords, usd } from "@/lib/format";
import { SITE } from "@/lib/site";
import { FREE_BEST_BETS_A_DAY } from "@/lib/entitlements";
import { CONNECTOR_NAME, connectorAllowance } from "@/lib/connector-plan";

const PLANS = [
  { id: "free", name: "Free", monthly: 0, yearly: 0, line: "See how it works.",
    points: [`${FREE_BEST_BETS_A_DAY} Best bets a day, chosen at random`, "Prices {delay}", "Estimated return shown as a range", "Exact numbers on 3 bets a day", "1 saved view · 10 bets in My list", "Results and win-chance charts", "Kalshi markets: prices, volume, Kalshi Combos"] },
  { id: "pro", name: "Pro", monthly: SITE.prices.pro_monthly, yearly: SITE.prices.pro_yearly, line: "For people who bet every week.",
    points: ["Every Best bet, live prices, no row limit", "Exact estimated return on every bet", "Every best bet, every filter", "Full price check: order book, stake table, how much you can bet", "Alerts by email (checked once a day) and in the browser while Kismet is open, 20 rules", `${CONNECTOR_NAME}: ${connectorAllowance("pro")}`, "My bets with profit and closing-price tracking", "25 saved views · 3 dashboards · CSV export", "Kalshi markets: prices, volume, Kalshi Combos"] },
  { id: "premium", name: "Premium", monthly: SITE.prices.premium_monthly, yearly: SITE.prices.premium_yearly, line: "Everything in Pro, plus new features first.",
    points: ["Everything in Pro", `${CONNECTOR_NAME}: ${connectorAllowance("premium")}`, "Combos: 2- and 3-leg bets built from Best bets, plus your own combo builder", "100 alert rules", "Unlimited saved views and dashboards"] },
] as const;

/** Yearly savings from the prices (T-291 #15): per plan on its card, the largest on the toggle as "up to". */
const SAVE = yearlySavings(SITE.prices);
const savePct = (id: string) => (id === "pro" ? SAVE.pro : id === "premium" ? SAVE.premium : 0);

/** What the plan buttons need to know; the server's answer first, then /api/me's. */
export interface PlanCtx { demo: boolean; auth: boolean; billing: boolean; signedIn: boolean; tier: Tier }

function useCtx(initial: PlanCtx): PlanCtx {
  const me = useMe();
  return me ? { demo: me.demo, auth: me.auth, billing: me.billing, signedIn: !!me.user, tier: me.tier } : initial;
}

/** `delay`: the Free plan delay in minutes, from site settings (free_delay_min). `ctx`: lib/billing/planCtx.ts. */
/** #32 (Nov 20): "Start trial" while signed out goes through sign-up and comes back to /pricing?start=<plan>_<period>,
 *  which picks that period and opens that plan's checkout, instead of a generic free sign-up that forgot the plan. */
const START = /^(pro|premium)_(monthly|yearly)$/;
function startParam(): { id: string; annual: boolean } | null {
  if (typeof window === "undefined") return null;
  const m = START.exec(new URLSearchParams(window.location.search).get("start") ?? "");
  return m ? { id: m[1]!, annual: m[2] === "yearly" } : null;
}

export function Plans({ delay, ctx: initial }: { delay: number; ctx: PlanCtx }) {
  const [annual, setAnnual] = useState(false);
  const [resume, setResume] = useState<string | null>(null);
  useEffect(() => {   // the page is prerendered (T-295): read the query once in the browser
    const st = startParam();
    if (st) { setAnnual(st.annual); setResume(st.id); }
  }, []);
  const ctx = useCtx(initial);
  const demo = ctx.demo;
  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Billing period" className="flex w-fit gap-1 rounded-full border border-border bg-input p-1 text-sm">
        {[false, true].map((a) => (
          <button key={String(a)} type="button" role="radio" aria-checked={annual === a} onClick={() => setAnnual(a)}
            className={`min-h-11 rounded-full px-4 ${annual === a ? "bg-accent-bg text-accent-soft" : "text-soft hover:text-text"}`}>
            {a ? <>Yearly{SAVE.max > 0 && <span className="text-accent-softer"> · save up to {SAVE.max}%</span>}</> : "Monthly"}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const featured = p.id === "pro";
          const perMonth = annual ? p.yearly / 12 : p.monthly;
          return (
            <section key={p.id} aria-labelledby={`plan-${p.id}`}
              className={`flex flex-col gap-4 rounded-card border p-5 md:p-6 ${featured ? "border-accent-border bg-accent-bg" : "border-border bg-surface"}`}>
              <div>
                <h2 id={`plan-${p.id}`} className="text-lg font-semibold">{p.name}</h2>
                <p className={`text-sm ${featured ? "text-accent-softer" : "text-muted"}`}>{p.line}</p>
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="font-heading text-[36px] font-bold leading-none tracking-[-0.02em]" data-testid={`price-${p.id}`}>{usd(Math.round(perMonth * 100) / 100)}</span>
                <span className={`text-sm ${featured ? "text-accent-softer" : "text-muted"}`}>/ month</span>
              </p>
              <p className={`-mt-2 min-h-5 text-xs ${featured ? "text-accent-softer" : "text-muted"}`}>
                {p.monthly === 0 ? "Free forever" : annual ? <>{usd(p.yearly)} billed yearly{savePct(p.id) > 0 && <span data-testid={`save-${p.id}`}> · save {savePct(p.id)}%</span>}</> : "7-day free trial"}
              </p>
              <ul className={`flex flex-1 flex-col gap-2 text-sm ${featured ? "text-accent-soft" : "text-soft"}`}>
                {p.points.map((x) => (
                  <li key={x} className="flex gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" className="mt-0.5 shrink-0" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    {x.replace("{delay}", behindWords(delay))}
                  </li>
                ))}
              </ul>
              <PlanButton resume={resume === p.id} id={p.id} annual={annual} ctx={ctx} featured={featured} />
            </section>
          );
        })}
      </div>
      {demo && <p className="text-xs text-muted">Demo: every feature is unlocked. No account or card needed.</p>}
    </div>
  );
}

function PlanButton({ id, annual, ctx, featured, resume = false }: { id: string; annual: boolean; ctx: PlanCtx; featured: boolean; resume?: boolean }) {
  const [busy, setBusy] = useState(false);
  const resumed = useRef(false);
  const ready = resume && !ctx.demo && ctx.billing && ctx.signedIn && ctx.tier === "free";
  useEffect(() => {   // #32: back from sign-up with this plan chosen: open its checkout once
    if (!ready || resumed.current) return;
    resumed.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const [error, setError] = useState("");
  const cls = `flex min-h-11 items-center justify-center rounded-input px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${featured ? "bg-accent text-on-accent hover:bg-accent-hover" : "border border-border bg-muted-bg hover:border-accent-border"}`;
  // P9: a signed-in Free user saw "Start free" on the plan they already have. T-291 #14: everyone else signs up.
  if (id === "free") return ctx.signedIn && ctx.tier === "free"
    ? <Link href="/account" className={cls}>Your plan</Link>
    : <Link href="/signup" className={cls} data-testid="start-free">Start free</Link>;
  if (ctx.demo) return <Link href="/" className={cls}>Start trial</Link>;
  if (!ctx.billing) return <button type="button" disabled className={cls}>Coming soon</button>;
  if (!ctx.signedIn) {
    const back = `/pricing?start=${id}_${annual ? "yearly" : "monthly"}`;
    return <Link href={`/signup?next=${encodeURIComponent(back)}`} className={cls} data-testid={`start-trial-${id}`}>Start trial</Link>;
  }
  if (ctx.tier === id) return <Link href="/account" className={cls}>Your plan</Link>;
  const tier = ctx.tier;

  async function start() {
    setBusy(true);
    setError("");
    if (tier === "free") track("checkout_started");
    // Already paying: plan changes go through the Stripe portal, never a second subscription.
    const res = await (tier === "free"
      ? fetch("/api/stripe/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: `${id}_${annual ? "yearly" : "monthly"}` }),
      })
      : fetch("/api/stripe/portal", { method: "POST" })).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.url) return window.location.assign(body.url);
    setBusy(false);
    setError(body?.error ?? "Couldn't start checkout. Try again.");
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" className={cls} disabled={busy} onClick={start} data-testid={`checkout-${id}`}>
        {busy ? "Opening checkout…" : tier === "free" ? "Start trial" : `Switch to ${id === "pro" ? "Pro" : "Premium"}`}
      </button>
      {error && <p role="alert" className="text-xs text-warning">{error}</p>}
    </div>
  );
}

/** `id` makes an entry linkable (/about#returns, T-289); `open` shows it expanded on load. */
export function Faq({ items }: { items: { q: string; a: React.ReactNode; id?: string; open?: boolean }[] }) {
  return (
    <div className="divide-y divide-border rounded-card border border-border bg-surface">
      {items.map(({ q, a, id, open }) => (
        <details key={q} id={id} open={open} className="group scroll-mt-24 px-4 md:px-5">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-medium [&::-webkit-details-marker]:hidden">
            {q}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted group-open:rotate-45" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </summary>
          <div className="max-w-2xl pb-4 text-sm leading-relaxed text-soft">{a}</div>
        </details>
      ))}
    </div>
  );
}
