"use client";

// Compact row card (MobileHybrid artboard): topic · closes, question, then what happens on this one bet
// ("Pays 10x · wins about 1 in 7", docs/18 §6), the price line, and the return on the right, smaller.
// The question link covers the card (opens the drawer); star and alert sit above it.
import type { ApiRow } from "@/lib/api";
import { useWhen } from "./When";
import { basis, pct, priceAsOf, sideEdge } from "@/lib/format";
import { betFigures, RETURN_HELP_ONE } from "@/lib/betFigures";
import { WatchStar } from "@/components/watch/WatchStar";
import { VenueIconLink } from "@/components/trade/TradeButton";
import { drawerHref, useOpenDrawer } from "./drawer";
import { AlertLink, Notes } from "./bits";
import { PTS_HELP, VERDICT_TONE, returnTone, rowNotes, topicLabel } from "./labels";
import { LowerConfidence, TierNote } from "./TierNote";

export function MarketCard({ r, pro = false, notes = true }: { r: ApiRow; pro?: boolean; notes?: boolean }) {
  const { open } = useOpenDrawer();
  const { market: m, side: s } = r;
  const when = useWhen(m.closes_at);
  const edgeTier = m.tier === "edge";
  const f = betFigures(s, { market: m });   // T-289/QA-B: the same price, payout, return and $10 stake as BetCard and the drawer
  const ret = f.ret;
  return (
    <div data-row data-market-id={m.id} data-tier={m.tier ?? undefined} className="relative flex gap-3 rounded-inner border border-border bg-surface p-3.5 hover:border-soft/30 focus-within:border-soft/30">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span title={when.Closes} suppressHydrationWarning>{topicLabel(m)} · <span className="whitespace-nowrap" suppressHydrationWarning>{when.game}</span></span>
          {edgeTier && <LowerConfidence className="py-0" />}
        </div>
        <a
          href={drawerHref(m.id, s.side_index)}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            open(m.id, s.side_index);
          }}
          className="mt-0.5 block text-[15px] font-semibold leading-snug after:absolute after:inset-0 after:rounded-inner focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-accent focus-visible:after:outline-offset-2"
        >
          {m.question}
        </a>
        {/* no "·" separators: on a 390 px card they wrapped to the start or end of a line */}
        <p data-testid="one-bet" className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-sm" title={basis(m, s)}>
          <span className="whitespace-nowrap" title={f.feeHelp}><span className="font-heading font-bold">Pays {f.pays}</span> <span className="text-soft">after the fee</span></span>
          <span className="whitespace-nowrap text-soft" title={`Won ${f.winPct} of the time in similar past bets`}>wins about {f.wins}</span>
        </p>
        <div className="mt-0.5 text-xs text-muted">
          Bet {s.outcome} at {pct(f.ask)}
          <span data-testid="verdict" className={`block ${VERDICT_TONE[f.verdict.tone]}`}>{f.verdict.text.toLowerCase()} <span className="whitespace-nowrap" title={PTS_HELP}>({f.pts})</span></span>
          {r.price_at && <span data-testid="price-as-of" className="block" title="Live Polymarket price read when this page loaded; edge, Pays and payout use it.">{priceAsOf(r.price_at)}</span>}
          {f.payout !== null && (
            <span data-testid="payout" className="block" title={f.feeHelp}>
              <span className="whitespace-nowrap">Bet <span className="tabular-nums text-soft">{f.stakeText}</span> →</span>{" "}
              <span className="whitespace-nowrap">get <span className="font-semibold tabular-nums text-text">{f.payoutText}</span> back</span>{" "}
              <span className="whitespace-nowrap">if it wins</span>
            </span>
          )}
        </div>
        {notes && <Notes notes={rowNotes(m.execution)} className="mt-1" />}
        {edgeTier && <TierNote s={s} className="mt-1" />}
      </div>
      <div className="flex flex-none flex-col items-end justify-between gap-1">
        <div className="text-right">
          <div data-testid="bet-return" className={`font-heading text-lg leading-tight ${returnTone(ret.roi)}`} title={f.quote.math ?? RETURN_HELP_ONE}>{ret.text}</div>
          <div className="text-[11px] text-muted">estimated{pro && <> · edge {sideEdge(s)}</>}</div>
        </div>
        <div className="relative z-10 -mb-2 -mr-2 flex">
          <WatchStar marketId={m.id} side={s.side_index} market={m} />
          <VenueIconLink m={m} />
          <AlertLink marketId={m.id} side={s.side_index} />
        </div>
      </div>
    </div>
  );
}
