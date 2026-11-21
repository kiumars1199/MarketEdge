"use client";

// Best bets card, rebuilt for casual bettors on a phone (docs/OVERHAUL.md §B, §G1; docs/overhaul-contract.md § Card).
// The face shows seven things, each in its own data-slot (the e2e check counts them, e2e/overhaul-cards.spec.ts):
//   title ("Crystal Palace to win") · side + price ("Bet Yes at 68¢") · chance ("Wins about 7 in 10", R2-1) ·
//   money ("$10 wins $5.60", after the fee) · value (1–3 stars, R2-4) · closing time · the bet button.
// Everything else (record, sample, estimate, return, warnings, watch star, alert bell, live price, the international
// link) sits in "Why this bet?" (components/market/card/Why.tsx). §G1: a market on Polymarket US shows the US price,
// return and button; one that isn't (us === null) shows a grey "International only" label and no bet button.
// Exported for other lanes: <BetCard r={{ market, side }} /> (landing imports it).
import { useRef } from "react";
import type { ApiRow } from "@/lib/api";
import { betQuote, quoteStars, RETURN_HELP_ONE } from "@/lib/betFigures";
import { cardVenue, chanceLine, INTL_ONLY, plainTitle, sideLabel, starsHelp, US_SMALL_PRINT } from "@/lib/card";
import { useEntitlements } from "@/lib/entitlements";
import { VenueButton } from "@/components/trade/VenueButton";
import { useWhen } from "./When";
import { drawerHref, useOpenDrawer } from "./drawer";
import { useLiveAsk } from "./live";
import { StarRating } from "./card/Stars";
import { Why } from "./card/Why";

export function BetCard({ r }: { r: ApiRow; pro?: boolean }) {
  const { open } = useOpenDrawer();
  const { market: m, side: s } = r;
  const when = useWhen(m.closes_at);
  const ref = useRef<HTMLElement>(null);
  const v = cardVenue(m, s);
  // Pro's live price (60 s, from /api/book) is the international book: shown inside "Why this bet?" only, and only
  // for a card priced there
  const live = useLiveAsk(m.tokens?.[s.side_index], useEntitlements().can("live_data") && v.kind !== "us", ref);
  const dir = live && Math.abs(live.ask - s.ask) >= 0.005 ? (live.ask > s.ask ? "up" : "down") : null;
  const title = plainTitle(m, s);
  // QA-B #55/#20/#37: the card's one payout and one return, from the same quote as the drawer, table and stake box
  const q = betQuote(m, s);
  const money10 = q.paysText && `Pays ${q.paysText}`;
  const noUsPrice = v.kind === "us" && v.ask == null;
  const st = noUsPrice ? undefined : quoteStars(q, s.model_neff);
  const nowPays = live && betQuote(null, s, { ask: live.ask }).paysText;
  return (
    <article ref={ref} data-testid="bet-card" data-row data-market-id={m.id} data-tier={m.tier ?? undefined} data-venue={v.kind}
      className="relative flex w-full flex-1 flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 shadow-sm shadow-black/20 transition-colors duration-200 ease-out hover:border-soft/30">
      <h3 data-slot="title" className="line-clamp-3 text-[17px] font-semibold leading-snug text-text">
        <a href={drawerHref(m.id, s.side_index)} title={m.question}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            open(m.id, s.side_index);
          }}
          className="block min-h-11 py-1 after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent">
          {title}
        </a>
      </h3>
      <p data-slot="side" className="-mt-2 text-sm text-soft">
        {sideLabel(s)}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p data-slot="chance" data-testid="card-chance" className="text-[15px] font-medium text-text">{chanceLine(s.win_prob)}</p>
        {st !== undefined && (
          <p data-slot="value" data-testid="card-value" className="text-sm">
            <StarRating st={st} title={`${starsHelp(st)} ${RETURN_HELP_ONE}`}>
              <span data-testid="card-return" className="whitespace-nowrap">{q.retText} est. return</span>
            </StarRating>
          </p>
        )}
      </div>
      <p data-slot="money" data-testid="card-money" className="text-sm">
        {noUsPrice ? <span className="text-muted">No Polymarket US price right now</span>
          : money10 && <span className="font-heading text-xl font-bold tabular-nums text-accent">{money10}</span>}
        {v.kind === "us" && !noUsPrice && <span data-testid="us-small-print" className="block text-xs text-muted">{US_SMALL_PRINT}</span>}
        {/* #15 (Mark, Nov 20): the multiplier already takes the fee off */}
        {v.kind !== "us" && money10 && <span data-testid="fee-small-print" className="block text-xs text-muted">After Polymarket&apos;s fee</span>}
      </p>
      <p data-slot="closes" className="text-xs text-muted" title={when.full ?? when.Closes} suppressHydrationWarning>
        {when.game} · {when.closes}
      </p>
      <div data-slot="bet" className="mt-auto pt-1">
        {v.kind === "intl-only"
          ? <p data-testid="intl-only" className="flex min-h-11 items-center justify-center rounded-xl border border-border bg-raised/60 px-3 text-center text-xs text-muted">{INTL_ONLY}</p>
          : <VenueButton m={m} s={s} className="min-h-12 w-full sm:min-h-11" />}
      </div>
      <Why r={r} livePrice={live && (
        <span data-testid="live-price" className="block text-xs text-muted">
          Now pays {nowPays ?? "—"} after the fee
          {dir && <span aria-label={`price ${dir} since ${r.price_at ? "this page loaded" : "the last update"}`} className={dir === "up" ? "text-warning" : "text-accent"}> {dir === "up" ? "▲" : "▼"}</span>}
        </span>
      )} />
    </article>
  );
}
