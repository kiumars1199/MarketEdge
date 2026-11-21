// Which venue a market's link opens. Its own light module so the bet card (and the landing) don't pull in the
// trade ticket and extension code from components/trade/TradeButton (T-295 JS budget).
import type { Market } from "@/lib/types";
import { kalshiMarketUrl } from "@/lib/trade/urls";

export function venueOf(m: Pick<Market, "url" | "kalshi_ticker">): { name: "Kalshi" | "Polymarket"; href: string } {
  return m.kalshi_ticker ? { name: "Kalshi", href: kalshiMarketUrl(m.kalshi_ticker) } : { name: "Polymarket", href: m.url };
}
