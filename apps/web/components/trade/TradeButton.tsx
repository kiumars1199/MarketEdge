"use client";
// "Open on Kalshi / Polymarket" (every bet, on by default) and the paper "Trade" button (docs/16 §2, §4).
import { ExternalLink } from "@/components/kit/icons";
import { openTicket, useTradeConfig } from "@/lib/trade/ext";
import type { Market, Side } from "@/lib/types";

/** Kalshi when the market has a mapped ticker, else Polymarket. */
import { venueOf } from "@/lib/trade/venue";
export { venueOf };

export function VenueLink({ m, className = "" }: { m: Pick<Market, "url" | "kalshi_ticker">; className?: string }) {
  const v = venueOf(m);
  return (
    <a href={v.href} target="_blank" rel="noopener noreferrer" className={className} onClick={(e) => e.stopPropagation()}>
      Open on {v.name} <ExternalLink size={15} className="inline-block align-[-2px]" />
    </a>
  );
}

/** Icon-size venue link for cards; sits above the card's full-cover link like the alert bell. */
export function VenueIconLink({ m, className = "" }: { m: Pick<Market, "url" | "kalshi_ticker">; className?: string }) {
  const v = venueOf(m);
  return (
    <a
      data-venue={v.name.toLowerCase()} href={v.href} target="_blank" rel="noopener noreferrer"
      aria-label={`Open on ${v.name}`} title={`Open on ${v.name}`} onClick={(e) => e.stopPropagation()}
      className={`relative z-10 flex size-11 flex-none items-center justify-center rounded-input text-muted hover:bg-raised hover:text-text ${className}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
    </a>
  );
}

/** Shown only when KALSHI_TRADING_ENV=demo and the user is allow-listed (or demo mode). */
export function TradeButton({ m, s, className }: { m: Market; s: Side; className: string }) {
  const cfg = useTradeConfig();
  if (!cfg) return null;
  const yes = m.sides[0], no = m.sides[1];
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        openTicket({
          title: m.question,
          ticker: m.kalshi_ticker ?? null,
          side: s.side_index,
          sides: [
            { label: yes?.outcome ?? "Yes", winProb: yes?.win_prob ?? null, ask: yes?.ask ?? null },
            { label: no?.outcome ?? "No", winProb: no?.win_prob ?? null, ask: no?.ask ?? null },
          ],
          journal: { market_id: m.id, question: m.question, category: m.category, niche: m.niche },
        })
      }
    >
      Trade <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-medium text-warning">paper</span>
    </button>
  );
}
