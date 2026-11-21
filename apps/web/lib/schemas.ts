// Zod mirrors of lib/types.ts, used to validate engine output on load (log, don't crash).
import "@/lib/zod-jitless";
import { z } from "zod";

export const Category = z.enum(["sports", "crypto", "politics", "finance", "culture", "weather", "tech", "geopolitics", "other"]);
export const MarketType = z.enum(["moneyline", "spreads", "totals", "props", "yes/no", "multi-outcome"]);
export const ModelLevel = z.enum(["all", "cat", "niche", "nmt"]);
export const Verdict = z.enum(["worth it", "thin", "not worth it", "no sellers", "no book"]);

export const ScanMeta = z.object({
  instance: z.string(),
  platform: z.enum(["polymarket", "kalshi"]),
  scanned_at: z.number(),
  model_half_life_days: z.number().nullable(),
  markets_scanned: z.number(),
  flags: z.number(),
  verdicts: z.record(z.string(), z.number()).optional(),
  tiers: z.object({ best: z.number(), edge: z.number() }).optional(),
  rule: z.object({ min_edge: z.number(), confidence_z: z.number(), price_range: z.tuple([z.number(), z.number()]) }),
});

export const Side = z.object({
  side_index: z.union([z.literal(0), z.literal(1)]),
  outcome: z.string(),
  ask: z.number(), mid: z.number(), fee: z.number(),
  win_prob: z.number(), win_prob_low: z.number(),
  edge: z.number(), edge_low: z.number(), roi_pct: z.number(),
  model_level: ModelLevel, model_neff: z.number(), model_events: z.number(),
  realistic_edge: z.number().nullable().optional(),
});

const opt = z.number().optional();
export const Market = z.object({
  id: z.string(), question: z.string(),
  event: z.string(), event_id: z.string(), slug: z.string(), url: z.string(), image: z.string().nullable().optional(),
  tokens: z.tuple([z.string(), z.string()]),
  category: Category, niche: z.string(), market_type: MarketType, tags: z.array(z.string()),
  hours_to_close: z.number(), closes_at: z.number(),
  horizon_h: z.union([z.literal(1), z.literal(6), z.literal(24), z.literal(72), z.literal(168)]),
  volume: z.number(), liquidity: z.number(), spread: z.number(),
  validated: z.boolean(),
  backtest: z.object({ flags: z.number(), pnl_cents: z.number(), t: z.number() }).nullable(),
  sides: z.array(Side), best: Side,
  volume_24h: opt.nullable(), created_at: opt.nullable(), competitive: opt,
  kalshi_ticker: z.string().nullable().optional(), kalshi_match_conf: opt,
});

export const StakeRow = z.object({
  stake_usd: z.number(), filled_usd: z.number(), shares: z.number(), avg_price: z.number(),
  edge: z.number(), expected_profit_usd: z.number(), roi_pct: z.number(),
});
export const Execution = z.object({
  book_ok: z.boolean(), best_bid: z.number().nullable(), best_ask: z.number(), book_mid: z.number(),
  spread: z.number(), spread_cost: z.number(), fee_at_ask: z.number(),
  gross_edge: z.number(), net_edge: z.number(), retention: z.number(), capacity_usd: z.number(),
  stakes: z.array(StakeRow), limit_price: z.number(), limit_edge: z.number(),
  verdict: Verdict, warning: z.string().optional(),
  ask_size: z.number().nullable().optional(), bid_size: z.number().nullable().optional(),
});
export const Flag = Market.extend({ execution: Execution, tier: z.enum(["best", "edge"]).optional() });
