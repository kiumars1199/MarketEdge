"use client";
// docs/OVERHAUL.md §B/§F1/§G1: the one "Bet on …" button on a bet card. Lane B places it; lane F1 owns what's inside.
// T-302 (§G1): a market listed on Polymarket US sends US bettors there ("Bet on Polymarket US", us.url); a market
// that isn't (us === null) has no primary button at all: the card says "International only" and keeps the
// international link inside "Why this bet?". A scan from before the US venue shipped (no `us` field) keeps the
// international venue as before. Keep the props stable.
import type { Market, Side } from "@/lib/types";
import { funnel } from "@/lib/telemetry";
import { venueOf } from "@/lib/trade/venue";

type VenueMarket = Pick<Market, "url" | "kalshi_ticker" | "id"> & Partial<Pick<Market, "us" | "best">>;

/** Where the primary button goes, or null when there is none (international only). The US quote prices the best side. */
export function primaryVenue(m: VenueMarket, s?: Pick<Side, "side_index">): { name: string; key: string; href: string } | null {
  if (m.us === undefined) {
    const v = venueOf(m);
    return { name: v.name, key: v.name.toLowerCase(), href: v.href };
  }
  if (m.us && (!s || !m.best || s.side_index === m.best.side_index)) return { name: "Polymarket US", key: "polymarket-us", href: m.us.url };
  return null;
}

export function VenueButton({ m, s, className = "" }: { m: VenueMarket; s?: Pick<Side, "side_index">; className?: string }) {
  const v = primaryVenue(m, s);
  if (!v) return null;
  return (
    <a data-venue={v.key} data-testid="venue-button" href={v.href} target="_blank" rel="noopener noreferrer"
      onClick={(e) => { e.stopPropagation(); funnel("first_bet_click"); }}
      className={`relative z-10 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}>
      Bet on {v.name}
    </a>
  );
}
