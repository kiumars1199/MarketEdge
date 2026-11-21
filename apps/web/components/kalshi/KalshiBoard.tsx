// Kalshi markets and Kalshi Combos (docs/03 § kalshi.json). Server component. Every number is Kalshi's and carries a
// visible "Kalshi" credit; every link goes to kalshi.com in a new tab.
import type { ReactNode } from "react";
import { DASH, closesIn, formatCount, pays, price } from "@/lib/format";
import type { KalshiCombo, KalshiFile, KalshiMarket } from "@/lib/types";
import { Ago } from "@/components/clock";   // QA-A #44: the age keeps counting

const cents = (c: number | null | undefined) => (typeof c === "number" ? price(c / 100) : DASH);
const closes = (iso: string | null) => (iso ? closesIn(Date.parse(iso) / 1000) : DASH);

/** A Kalshi number with its credit underneath: "63¢ / Kalshi". `what` names it for the hover ("Price: Kalshi"). */
export function KalshiNum({ children, what = "Price" }: { children: ReactNode; what?: string }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight" title={`${what}: Kalshi`} data-kalshi-credit>
      <span className="tabular-nums text-text">{children}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted">Kalshi</span>
    </span>
  );
}

export function KalshiLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`group inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:text-accent hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}>
      {children}
      <svg aria-hidden="true" viewBox="0 0 12 12" className="size-2.5 shrink-0 self-center text-muted group-hover:text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4.5 2.5h5v5M9.5 2.5 3 9" />
      </svg>
      <span className="sr-only"> (opens kalshi.com in a new tab)</span>
    </a>
  );
}

const th = "px-3 py-2.5 text-xs font-medium text-muted md:px-4";

function MarketsTable({ markets }: { markets: KalshiMarket[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Kalshi markets by volume. Prices, volume and close times: Kalshi.</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className={th}>Market</th>
            <th scope="col" className={`${th} text-right`}>Yes bid</th>
            <th scope="col" className={`${th} text-right`}>Yes ask</th>
            <th scope="col" className={`${th} text-right`}>Volume</th>
            <th scope="col" className={`${th} text-right`}>Closes in</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m) => (
            <tr key={m.ticker} className="border-t border-border first:border-t-0 hover:bg-raised">
              <td className="px-3 py-2.5 md:px-4">
                <KalshiLink href={m.url} className="font-medium text-text">{m.title}</KalshiLink>
                {m.subtitle && m.subtitle !== m.title && <span className="block text-xs text-muted">{m.subtitle}</span>}
              </td>
              <td className="px-3 py-2.5 text-right md:px-4"><KalshiNum>{cents(m.yes_bid_cents)}</KalshiNum></td>
              <td className="px-3 py-2.5 text-right md:px-4"><KalshiNum>{cents(m.yes_ask_cents)}</KalshiNum></td>
              <td className="px-3 py-2.5 text-right md:px-4"><KalshiNum what="Volume">{formatCount(m.volume)}</KalshiNum></td>
              <td className="px-3 py-2.5 text-right md:px-4"><KalshiNum what="Close time">{closes(m.close_time)}</KalshiNum></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComboRow({ c }: { c: KalshiCombo }) {
  const quote = c.price_basis === "kalshi_quote";
  const cost = quote ? c.kalshi_yes_ask_cents : c.legs_product_cents;
  return (
    <li className="grid gap-4 border-t border-border px-4 py-4 first:border-t-0 md:grid-cols-[1fr_auto] md:px-5">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          <KalshiLink href={c.url}>Kalshi Combo · {c.legs.length} legs</KalshiLink>
        </p>
        <ol className="mt-2 flex flex-col gap-1.5">
          {c.legs.map((l) => (
            <li key={`${l.market_ticker}-${l.side}`} className="flex items-start justify-between gap-4 text-sm">
              <span className="min-w-0">
                <span className={`mr-2 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase ${l.side === "yes" ? "bg-accent-bg text-accent-soft" : "bg-muted-bg text-soft"}`}>{l.side}</span>
                <KalshiLink href={l.url} className="text-soft">{l.title}</KalshiLink>
              </span>
              <KalshiNum>{cents(l.ask_cents)}</KalshiNum>
            </li>
          ))}
        </ol>
        {c.same_event && <p className="mt-2 text-xs text-warning">Two legs are on the same event, so they move together; only Kalshi&apos;s own quote applies.</p>}
      </div>
      <div className="flex flex-row items-end justify-between gap-6 md:flex-col md:items-end md:justify-start md:text-right">
        <div className="flex flex-col items-end">
          <span className="text-2xl font-semibold leading-none"><KalshiNum>{cents(cost)}</KalshiNum></span>
          <span className="mt-1 text-xs text-muted">{quote ? "Kalshi's combo ask" : "Legs' Kalshi asks multiplied"}</span>
        </div>
        <span className="text-sm text-soft" title="What $1 returns if every leg wins: $1 ÷ price, before the fee. Price: Kalshi.">
          pays {pays(typeof cost === "number" ? cost / 100 : null)}
        </span>
      </div>
    </li>
  );
}

export function KalshiBoard({ data, limit = 100 }: { data: KalshiFile; limit?: number }) {
  const markets = data.markets.slice(0, limit);
  return (
    <article className="mx-auto flex max-w-5xl flex-col gap-10 pb-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">Kalshi markets</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          Live prices and volume from Kalshi, read with each scan. These are Kalshi&apos;s numbers as they stand; Kismet
          has no win-chance estimate on them yet.
        </p>
        <p className="text-sm text-soft">
          Data: <KalshiLink href="https://kalshi.com">Kalshi</KalshiLink> · updated <Ago at={data.meta.fetched_at} />
        </p>
      </header>

      <section aria-labelledby="kalshi-markets-h" className="flex flex-col gap-3">
        <h2 id="kalshi-markets-h" className="text-xl font-semibold">Most traded</h2>
        {markets.length ? <MarketsTable markets={markets} /> : <p className="text-sm text-muted">Kalshi returned no open markets on the last scan.</p>}
        {data.markets.length > markets.length && (
          <p className="text-xs text-muted">Top {markets.length} of {formatCount(data.markets.length)} by volume. The rest are on kalshi.com.</p>
        )}
      </section>

      <section aria-labelledby="kalshi-combos-h" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="kalshi-combos-h" className="text-xl font-semibold">Kalshi Combos</h2>
          <p className="max-w-2xl text-sm text-muted">
            One contract that pays $1 if every leg wins. Kalshi&apos;s combo markets usually show no resting ask, so then
            we multiply the legs&apos; own Kalshi asks instead and say so. Many legs means it usually loses.
          </p>
        </div>
        {data.combos.length ? (
          <ul className="rounded-card border border-border bg-surface">{data.combos.map((c) => <ComboRow key={c.ticker} c={c} />)}</ul>
        ) : (
          <p className="text-sm text-muted">No Kalshi combo had a price on the last scan.</p>
        )}
      </section>
    </article>
  );
}
