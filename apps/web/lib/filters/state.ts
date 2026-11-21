// FilterState: one object drives URL, presets, alerts and the API (docs/04 § FilterState).
import "@/lib/zod-jitless";
import { z } from "zod";
import { Category, MarketType, Verdict } from "@/lib/schemas";

export const SortKey = z.enum([
  "edge", "edge_low", "realistic_edge", "roi", "win_prob", "price", "closes",
  "volume", "volume_24h", "liquidity", "spread", "capacity", "retention",
  "evidence", "competitive", "newest",
  "pays",                                            // 1 / (ask + fee); "Biggest payout" (docs/18 §3); reorders only (QA-A #68)
]);
export type SortKey = z.infer<typeof SortKey>;

export const PeriodEnum = z.enum(["full", "1H", "2H", "1Q", "2Q", "3Q", "4Q"]);
export const FrequencyEnum = z.enum(["recurring", "15M", "hourly", "daily", "weekly"]);
export const SideChoice = z.enum(["best", "yes", "no", "favorite", "underdog"]);

export const FilterState = z.object({
  v: z.literal(1).default(1),
  q: z.string().max(120).optional(),
  view: z.enum(["markets", "flags"]).default("markets"),
  tier: z.enum(["best", "edge", "all"]).default("best"),   // flags view only (docs/18 §2); widened by tierOf()
  categories: z.array(Category).optional(),          // include
  exclude_categories: z.array(Category).optional(),  // "hide sports"
  topics: z.array(z.string()).optional(),            // taxonomy ids, OR within, AND with categories
  market_types: z.array(MarketType).optional(),
  periods: z.array(PeriodEnum).optional(),
  side: SideChoice.default("best"),
  price_min: z.number().min(0).max(1).optional(), price_max: z.number().min(0).max(1).optional(),
  pays_min: z.number().optional(), pays_max: z.number().optional(),   // payout multiplier 1/ask, [min, max) (docs/13 §2)
  win_prob_min: z.number().optional(), win_prob_max: z.number().optional(),
  edge_min: z.number().optional(),                   // e.g. 0.02
  edge_low_positive: z.boolean().optional(),         // confident only
  roi_min: z.number().optional(),
  validated_only: z.boolean().optional(),
  verdicts: z.array(Verdict).optional(),             // flags view
  // flags view: only bets you can place on Polymarket US at a price still worth it there (docs/OVERHAUL.md §G2).
  // On by default for every tier; a no-op on a scan without US coverage (lib/filters/us.ts usActive).
  us: z.boolean().default(true),
  retention_min: z.number().optional(), capacity_min_usd: z.number().optional(),
  min_events: z.number().int().optional(),           // evidence size
  closes_within_h: z.number().optional(), closes_after_h: z.number().optional(),
  live_only: z.boolean().optional(),
  frequency: z.array(FrequencyEnum).optional(),
  volume_min: z.number().optional(), volume_24h_min: z.number().optional(),
  liquidity_min: z.number().optional(), spread_max: z.number().optional(),
  watchlisted_only: z.boolean().optional(), favorites_only: z.boolean().optional(),
  group_by_event: z.boolean().default(true),
  sort: z.object({ key: SortKey, dir: z.enum(["asc", "desc"]) })
        .default({ key: "roi", dir: "desc" }),       // shown as "Best estimated return"
  win_prob_floor_default: z.number().default(0.4),     // default view hides < 40% chance (long shots)
  tz: z.string().max(64).regex(/^[A-Za-z0-9_+\-/]+$/).optional(),   // IANA zone for "today"/"tomorrow" in q
  page: z.number().int().min(1).default(1), page_size: z.number().int().min(1).max(200).default(50),
});
export type FilterState = z.infer<typeof FilterState>;
export type FilterInput = z.input<typeof FilterState>;

/** docs/18 §3: on the flags view, a Pays filter or the "Biggest payout" sort searches both tiers, so asking for
 *  10x finds the lower-confidence bets too. An explicit tier=edge stays as asked. */
export const tierOf = (f: Pick<FilterState, "tier" | "pays_min" | "pays_max" | "sort">): FilterState["tier"] =>
  f.tier === "best" && (f.pays_min !== undefined || f.pays_max !== undefined) ? "all" : f.tier;   // QA-A #68: a sort never widens the set

export const defaultState = (): FilterState => FilterState.parse({});

/** Best bets = flags whose price check isn't "not worth it". */
export const BEST_BETS_VERDICTS: z.infer<typeof Verdict>[] = ["worth it", "thin"];

/** Best bets "Closing soon" strip: the same query on the server's first page (lib/data/respond.ts firstPage) and in
 *  the browser (BestBets), so the server-rendered strip is the one the client would fetch. */
export const CLOSING_SOON: Partial<FilterState> = { closes_within_h: 3, sort: { key: "closes", dir: "asc" }, page: 1, page_size: 5, group_by_event: false };
