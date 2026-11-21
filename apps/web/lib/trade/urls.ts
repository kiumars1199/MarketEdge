// Venue links (T-295: own module, so the trade button on every bet card doesn't pull the order schemas and zod).
export const kalshiMarketUrl = (ticker: string) => `https://kalshi.com/markets/${encodeURIComponent(ticker.toLowerCase())}`;
