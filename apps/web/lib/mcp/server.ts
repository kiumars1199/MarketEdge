// Kismet MCP server (T-280): five read-only tools over the same data, gates and wording as the site.
// Plans (docs/01 § Tiers, lib/connector-plan.ts): Premium no daily cap (60 calls a minute), Pro 3 calls a day, Free none. Gating runs per
// tools/call, not per HTTP request: initialize and tools/list are separate requests and stay open to any valid token.
// No personalized picks (CLAUDE.md rule 4): every verdict is the public one; my_list is the user's own saved order.
import "server-only";
import "@/lib/zod-jitless";
import { z } from "zod";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { DISCLAIMER } from "@/components/shell/Footer";
import { getMeForUser, supabaseAdmin, type Me, type SessionUser } from "@/lib/auth/server";
import { rateLimit, RULES } from "@/lib/abuse";
import { canBeta } from "@/lib/beta";
import { can } from "@/lib/entitlements";
import { getStoreFor, type Store } from "@/lib/data/store";
import { listBody, liveMarketBody } from "@/lib/data/respond";
import { chosenResult } from "@/lib/data/model";
import { nowFor } from "@/lib/filters/apply";
import { BEST_BETS_VERDICTS, FilterState } from "@/lib/filters/state";
import { Category } from "@/lib/schemas";
import { basis, betLine, closesLine, edge, formatCount, money, pct, price, ret, testedLine } from "@/lib/format";
import { betFigures, RETURN_LABEL_LONG, sideRecord } from "@/lib/betFigures";
import { HIT_RATE_VS_PROFIT, liveBase, siteProof } from "@/lib/proof";
import { PAYS_READ_TEXT, fmtRecord, paysRows, recordRows, tiles } from "@/lib/trackRecord";
import { siteUrl } from "@/lib/site";
import type { MarketsResponse } from "@/lib/api";
import type { Side, StoreMarket } from "@/lib/types";
import { userOf } from "./auth";
import { CONNECTOR_PLANS_LINE, connectorAllowance } from "@/lib/connector-plan";

export const MAX_LIMIT = 25;
const LEVEL: Record<string, string> = { all: "all markets", cat: "category", niche: "niche", nmt: "niche + type" };   // as lib/format basis()
export const PRO_DAILY = RULES.mcp_pro_daily.limit;
const pricing = () => `${siteUrl()}/pricing`;

export const FREE_REFUSAL = () =>
  `Using Kismet in Claude, ChatGPT or Cursor is not on the Free plan. ${CONNECTOR_PLANS_LINE.replace(" Not on Free.", "")} ` +
  `Upgrade at ${pricing()} and then ask again.`;
export const PRO_USED_UP = () =>
  `You've used today's Kismet calls: Pro includes ${PRO_DAILY} a day in AI assistants (a rolling 24 hours). ` +
  `Premium: ${connectorAllowance("premium")}. Upgrade at ${pricing()}, or use the site in the meantime: ${siteUrl()}.`;

/** Every tool answer ends with the site disclaimer (CLAUDE.md rule 5). */
const done = (lines: (string | null | undefined | false)[], isError = false): CallToolResult => ({
  content: [{ type: "text", text: [...lines.filter((l): l is string => typeof l === "string"), "", DISCLAIMER].join("\n") }],
  ...(isError ? { isError: true } : {}),
});
const refuse = (text: string) => done([text], true);

/** Any JSON-RPC reply (or batch) whose result is a tool result gets the disclaimer if it lacks one. */
export function withDisclaimer(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(withDisclaimer);
  const r = (body as { result?: { content?: unknown } } | null)?.result;
  if (!r || !Array.isArray(r.content)) return body;
  const has = r.content.some((c: { type?: string; text?: string }) => c?.type === "text" && c.text?.includes(DISCLAIMER));
  if (!has) r.content.push({ type: "text", text: DISCLAIMER });
  return body;
}

/** The plan gate for one tool call: the caller's plan from the same rule as the site (getMe), then the call quota. */
async function gate(user: SessionUser | null): Promise<{ me: Me } | { refused: CallToolResult }> {
  if (!user) return { refused: refuse("Sign in again: this connection has no Kismet account.") };
  let me: Me;
  try {
    me = await getMeForUser(user);
  } catch (e) {
    console.error("[mcp] plan lookup failed", e instanceof Error ? e.message : e);
    return { refused: refuse("Couldn't check your plan just now. Try again in a minute.") };
  }
  if (!can(me.tier, "live_data")) return { refused: refuse(FREE_REFUSAL()) };
  const key = `u:${user.id}`;
  if (me.tier === "premium") {
    const limited = await rateLimit("mcp_premium", key);
    if (limited) return { refused: refuse(`Too many calls: Premium allows ${RULES.mcp_premium.limit} a minute. Try again in ${limited.headers.get("Retry-After") ?? "60"} seconds.`) };
  } else {
    const limited = await rateLimit("mcp_pro_daily", key);
    if (limited) return { refused: refuse(PRO_USED_UP()) };
  }
  return { me };
}

/** Runs a tool body behind the gate; a data failure is an error result, never a crash. */
const gated = <A,>(fn: (args: A, me: Me, store: Store) => Promise<CallToolResult>) =>
  async (args: A, ctx: { http?: { authInfo?: Parameters<typeof userOf>[0] } }): Promise<CallToolResult> => {
    const g = await gate(userOf(ctx.http?.authInfo));
    if ("refused" in g) return g.refused;
    const { me } = g;
    let store: Store;
    try {
      store = await getStoreFor(me.tier);
    } catch (e) {
      console.error("[mcp] store load failed", e instanceof Error ? e.message : e);
      return refuse("Kismet's data is temporarily unavailable. Try again shortly.");
    }
    return fn(args, me, store);
  };

const marketUrl = (m: Pick<StoreMarket, "id">) => `${siteUrl()}/m/${encodeURIComponent(m.id)}`;

/** Where to bet: Kalshi when the site shows it (lib/beta.ts: KALSHI_DATA_PERMISSION=true). */
const venue = (m: StoreMarket, me: Me) =>
  m.kalshi_ticker && canBeta(me, "kalshi") ? `Kalshi (${m.kalshi_ticker})` : `Polymarket ${m.url}`;

/** One market side, with its basis one line away (CLAUDE.md rule 3). */
export function sideLines(m: StoreMarket, s: Side, now: number, n?: number): string[] {
  const f = betFigures(s, { market: m });   // T-289/QA-B: the same price, payout and return as the site's cards and drawer ($10 stake)
  const verdict = m.execution?.verdict;
  return [
    `${n ? `${n}. ` : ""}${m.question}`,
    `   ${betLine(s)} · ${f.feeLine} · wins about ${f.wins} (${f.winPct}, model) · ${f.verdict.text.toLowerCase()} (${f.pts}) · ${f.ret.text} ${RETURN_LABEL_LONG}`,
    `   ${verdict ? `Price check: ${verdict}` : "Not flagged"}${f.record ? ` · ${f.record}` : ""} · ${closesLine(m.closes_at, now)} · ${m.category}`,
    `   Basis: ${basis(m, s)}`,
    `   ${marketUrl(m)}`,
  ];
}

function pageLines(body: MarketsResponse, what: string, now: number): string[] {
  if (!body.rows.length) return [`No ${what} match these filters right now.`];
  const first = (body.page - 1) * body.page_size;
  return [
    `${formatCount(body.total)} ${what} match; showing ${first + 1}–${first + body.rows.length} (page ${body.page} of ${Math.max(1, body.pages)}).`,
    ...(body.search?.relaxed ? [body.search.relaxed] : []),
    "",
    ...body.rows.flatMap((r, i) => [...sideLines(r.market, r.side, now, first + i + 1), ""]),
  ];
}

const clamp = (n: number | undefined, d = 10) => Math.max(1, Math.min(MAX_LIMIT, Math.floor(n ?? d)));
const LIMIT = z.number().int().min(1).optional().describe(`How many results (default 10, at most ${MAX_LIMIT}; larger values are cut to ${MAX_LIMIT}).`);
const PAGE = z.number().int().min(1).max(1000).optional().describe("Page number, from 1.");
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const BestBetsInput = z.object({
  categories: z.array(Category).max(9).optional().describe("Only these categories."),
  pays_min: z.number().min(1).max(1000).optional().describe("Minimum payout per $1 (1 ÷ price), e.g. 2 for 2x."),
  pays_max: z.number().min(1).max(1000).optional().describe("Maximum payout per $1 (exclusive)."),
  tier: z.enum(["best", "edge", "all"]).optional().describe('"best" = Best bets (default), "edge" = more bets with a smaller sample, "all" = both.'),
  closing_within_hours: z.number().positive().max(24 * 90).optional().describe("Only markets closing within this many hours."),
  limit: LIMIT,
  page: PAGE,
});

/** best_bets → the /api/flags body for the same filters (Best bets view: price check "worth it" or "thin"). */
export async function bestBets(args: z.infer<typeof BestBetsInput>, me: Me, store: Store): Promise<CallToolResult> {
  const f = FilterState.parse({
    view: "flags", verdicts: BEST_BETS_VERDICTS, group_by_event: false,
    tier: args.tier ?? "best", categories: args.categories, pays_min: args.pays_min, pays_max: args.pays_max,
    closes_within_h: args.closing_within_hours, page: args.page ?? 1, page_size: clamp(args.limit),
  });
  const body = await listBody(store, f, me.tier, `u:${me.user!.id}`);
  if (!body) return refuse("That page is past the last page.");
  return done([`Best bets on Kismet (same list as ${siteUrl()}/bets, same for everyone):`, "", ...pageLines(body, "bets", nowFor(store) * 1000)]);
}

const SearchInput = z.object({
  query: z.string().min(1).max(120).describe('Words to search for, e.g. "lakers tonight" or "bitcoin above 100k".'),
  only_flagged: z.boolean().optional().describe("Only markets with a Kismet flag (priced below the model's win chance)."),
  limit: LIMIT,
  page: PAGE,
});

export async function searchMarkets(args: z.infer<typeof SearchInput>, me: Me, store: Store): Promise<CallToolResult> {
  const f = FilterState.parse({
    q: args.query, view: args.only_flagged ? "flags" : "markets", tier: "all", group_by_event: false,
    page: args.page ?? 1, page_size: clamp(args.limit),
  });
  const body = await listBody(store, f, me.tier, `u:${me.user!.id}`);
  if (!body) return refuse("That page is past the last page.");
  return done([`Markets matching "${args.query}":`, "", ...pageLines(body, "markets", nowFor(store) * 1000)]);
}

const GetMarketInput = z.object({
  market_id: z.string().min(1).max(100).describe("Kismet / Polymarket market id (from best_bets, search_markets or a kismetodds.com/m/<id> link)."),
});

export async function getMarket(args: z.infer<typeof GetMarketInput>, me: Me, store: Store): Promise<CallToolResult> {
  const id = args.market_id.trim().replace(/^.*\/m\//, "").replace(/[?#].*$/, "");
  const m = store.flagsById.get(id) ?? store.byId.get(id);
  if (!m) return refuse(`No market with id "${id}". Use search_markets to find one.`);
  const body = await liveMarketBody(store, m, me.tier);
  const mk = body.market, s = mk.best, x = mk.execution;
  const tested = testedLine(body.backtest ?? undefined, `Bets in ${mk.category}`);
  return done([
    mk.question,
    `Event: ${mk.event}`,
    "",
    ...sideLines(mk, s, nowFor(store) * 1000).slice(1).map((l) => l.trimStart()),
    `Other side: ${mk.sides.filter((o) => o.side_index !== s.side_index).map((o) => `${o.outcome} at ${price(o.ask)}, win chance ${pct(o.win_prob)}`).join("") || "—"}`,
    "",
    x ? "Price check (cost of crossing the spread, after the fee):" : "Price check: not run (this market isn't flagged).",
    ...(x ? [
      `  Verdict: ${x.verdict}${x.warning ? ` (${x.warning})` : ""}`,
      `  Best ask ${price(x.best_ask)} · best bid ${price(x.best_bid)} · spread cost ${price(x.spread_cost)} · fee ${price(x.fee_at_ask)} a share`,
      `  Edge after costs ${price(x.net_edge)} a share${typeof x.capacity_usd === "number" ? ` · about ${money(x.capacity_usd)} can be bought before the edge drops under the minimum` : ""}`,
    ] : []),
    "",
    `Model level: ${LEVEL[s.model_level] ?? s.model_level} · sample: ${formatCount(s.model_neff)} effective past bets, ${formatCount(s.model_events)} events${sideRecord(s) ? ` (${sideRecord(s)})` : ""}`,
    `Backtest basis: how bets like this did in testing (all ${mk.category} best bets, not this bet's ${RETURN_LABEL_LONG}): ${tested ?? `no walk-forward record for ${mk.category} yet`}${body.backtest ? ` · ${fmtRecord(body.backtest).bets} bets tested` : ""}`,
    ...(body.backtest && body.proof ? [`Live record beside it: ${body.proof.live}`] : []),
    body.price_at ? `Live price read ${Math.max(0, Math.round((Date.now() - body.price_at) / 1000))}s ago.` : `Scan price from ${new Date(store.meta.scanned_at * 1000).toISOString()}.`,
    `Bet on: ${venue(mk, me)}`,
    marketUrl(mk),
  ]);
}

export async function trackRecord(_args: unknown, _me: Me, store: Store): Promise<CallToolResult> {
  const b = store.backtest, r = chosenResult(b);
  const ledger = store.ledgerSummary;
  const once = liveBase(ledger);   // QA-A #49: each bet once, like /status and /track-record
  return done([
    "How Kismet's Best bets did in a walk-forward test (each week judged only on what came before):",
    ...tiles(b).map((t) => `  ${t.label}: ${t.text} (every bet, no filter: ${t.baseline})`),
    "",
    "By payout (1 ÷ price):",
    ...paysRows(r).filter((p) => p.main).map((p) => `  ${p.key}: ${PAYS_READ_TEXT[p.read]} (${fmtRecord(p.main).bets} bets, ${ret(p.main!.roi_pct)})`),
    "",
    "By category:",
    ...recordRows(r?.by_category).slice(0, 9).map((c) => `  ${c.key}: ${c.f.bets} bets, won ${c.f.won}, ${c.f.ret} return`),
    "",
    // T-290: the test return and the live record together, from the same helper as every page
    ...((p) => [p.test ?? "", p.live, `  Basis: ${p.help}`])(siteProof({ backtest: b, ledger, since: store.ledgerSince })),
    ...(once && once.graded ? [`  Settled so far: ${formatCount(once.wins)} won, ${formatCount(once.losses)} lost${typeof once.avg_pnl === "number" ? `, ${edge(once.avg_pnl)} average profit per $1 share` : ""}.`] : []),
    `  ${HIT_RATE_VS_PROFIT}`,
    `Full charts: ${siteUrl()}/track-record`,
  ]);
}

const ListInput = z.object({ limit: LIMIT, page: PAGE });

/** The user's saved markets in the order they saved them (as /watchlist lists them), each with the public verdict.
 *  Never re-ranked by return, edge or anything else: no personalized picks (CLAUDE.md rule 4). */
export async function myList(args: z.infer<typeof ListInput>, me: Me, store: Store): Promise<CallToolResult> {
  const size = clamp(args.limit), page = args.page ?? 1;
  const { data, error } = await supabaseAdmin()
    .from("watchlist").select("market_id, side_index, created_at")
    .eq("user_id", me.user!.id)
    .order("created_at", { ascending: true })
    .range((page - 1) * size, page * size - 1);
  if (error) {
    console.error("[mcp] watchlist read failed", error.message);
    return refuse("Couldn't read your list just now. Try again in a minute.");
  }
  const rows = (data ?? []) as { market_id: string; side_index: number | null }[];
  if (!rows.length) return done([page > 1 ? "No more saved markets." : `Your list is empty. Save markets on ${siteUrl()} to see them here.`]);
  const t = nowFor(store);
  return done([
    `Your saved markets, in the order you saved them (page ${page}). Verdicts are Kismet's public ones, the same for everyone:`,
    "",
    ...rows.flatMap((w, i) => {
      const m = store.flagsById.get(w.market_id) ?? store.byId.get(w.market_id);
      const n = (page - 1) * size + i + 1;
      if (!m) return [`${n}. Market ${w.market_id}: no longer in the scan (closed or removed).`, ""];
      const s = m.sides.find((x) => x.side_index === w.side_index) ?? m.best;
      return [...sideLines(m, s, t * 1000, n), ""];
    }),
  ]);
}

/** One server per request (stateless). Every tool is read-only: nothing places, changes or ranks anything. */
export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "kismet", title: "Kismet", version: "1.0.0", websiteUrl: siteUrl() },
    {
      instructions:
        "Kismet shows which prediction-market contracts are priced below their estimated win chance, after the fee and the cost " +
        "of crossing the spread. Results are market analytics based on past results, the same for every user, never advice. " +
        "Quote the basis (sample size, model level, backtest record) with any number, and keep the closing disclaimer.",
    },
  );
  server.registerTool("best_bets", {
    title: "Best bets",
    description: "Kismet's current Best bets: contracts priced below the model's win chance after fees and spread. Filters: category, payout, tier, closing time. At most 25 per page.",
    inputSchema: BestBetsInput, annotations: { title: "Best bets", ...READ_ONLY },
  }, gated(bestBets));
  server.registerTool("search_markets", {
    title: "Search markets",
    description: "Search open prediction markets Kismet scans (teams, topics, assets), with each market's price, model win chance and basis.",
    inputSchema: SearchInput, annotations: { title: "Search markets", ...READ_ONLY },
  }, gated(searchMarkets));
  server.registerTool("get_market", {
    title: "Market details",
    description: "One market in full: verdict, price check (spread and fee), win chance, sample size, model level and the backtest record behind it.",
    inputSchema: GetMarketInput, annotations: { title: "Market details", ...READ_ONLY },
  }, gated(getMarket));
  server.registerTool("track_record", {
    title: "Track record",
    description: "How Kismet's Best bets did in the walk-forward backtest and the live settled-bet record.",
    inputSchema: z.object({}), annotations: { title: "Track record", ...READ_ONLY },
  }, gated(trackRecord));
  server.registerTool("my_list", {
    title: "My saved markets",
    description: "Your saved markets on Kismet in the order you saved them, each with Kismet's public verdict. Not ranked or filtered for you.",
    inputSchema: ListInput, annotations: { title: "My saved markets", ...READ_ONLY },
  }, gated(myList));
  return server;
}
