// Server helpers shared by the API routes.
import { ctxOf, livePrices, repriceMarkets, repricePage, type QuoteSource } from "@/lib/reprice";
import { DelayedPending, getStore, getStoreFor, type Store } from "./store";
import { botCheck, clientIp, clientKey, noteRows, rateLimit, rowBudget, verifiedBot, type Rule } from "@/lib/abuse";
import { getMe, type Me } from "@/lib/auth/server";
import { freeView, gateMarket, gateMarkets } from "./gate";
import { categoryRecord, curve, segmentOf } from "./model";
import { FREE_BEST_BETS_A_DAY, can, type Tier } from "@/lib/entitlements";
import { bestBetsRows, freeUsOn } from "./counts";
export { freeUsOn };
import { delayMin, rowCap } from "@/lib/settings-core";
import { apply, nowFor, openOnly } from "@/lib/filters/apply";
import { parse } from "@/lib/filters/url";
import { RELAX_STEPS, relax, relaxedNote, type ParsedQuery } from "@/lib/search/parse";
import { BEST_BETS_VERDICTS, CLOSING_SOON, tierOf, type FilterState } from "@/lib/filters/state";
import { DELAYED_PENDING, delayedPendingLine, type EventResponse, type MarketResponse, type MarketsResponse } from "@/lib/api";
import type { LedgerStats, StoreMarket } from "@/lib/types";
import { proofLine, type Proof } from "@/lib/proof";
import { headers } from "next/headers";

/** RT-15: tier-shaped bodies must never sit in a shared cache. A route's own private Cache-Control is kept. */
export function noStore(res: Response): Response {
  if (!/\bprivate\b|no-store/.test(res.headers.get("cache-control") ?? "")) res.headers.set("Cache-Control", "private, no-store");
  res.headers.append("Vary", "Cookie");
  return res;
}

/** The store for `tier` (undefined = the newest scan); a load failure becomes a private 503 Response instead of a crash.
 *  Free with no delayed copy yet gets the honest "first update shortly" body (code DELAYED_PENDING). */
async function loadStore(tier: Tier | undefined, headers?: HeadersInit): Promise<Store | Response> {
  try {
    return tier ? await getStoreFor(tier) : await getStore();
  } catch (e) {
    if (e instanceof DelayedPending) {
      console.warn(e.message);
      const h = new Headers(headers);
      h.set("Retry-After", "60");
      return noStore(Response.json({ error: delayedPendingLine(delayMin("free")), code: DELAYED_PENDING }, { status: 503, headers: h }));
    }
    console.error("[api] store load failed", e);
    return noStore(Response.json({ error: "Data is temporarily unavailable" }, { status: 503, headers }));
  }
}

/** Runs `fn` with the store; a store load failure becomes 503 instead of a crash. With `tier`, Free gets the
 *  delayed scan (getStoreFor), so scan meta matches the data that tier sees; the body is private either way. */
export async function withStore(fn: (store: Store) => Response | Promise<Response>, headers?: HeadersInit, tier?: Tier): Promise<Response> {
  const store = await loadStore(tier, headers);
  if (store instanceof Response) return store;
  return noStore(await fn(store));
}

/** Like withStore, for tier-shaped routes: resolves the caller's plan (server-side, docs/15), runs BotID and the
 *  route's rate limit (in parallel, before the store load, so a refused request costs nothing), and serves free users the
 *  delayed scan. `fn` must shape its body with lib/data/gate.ts. `bot: false` = no BotID (extension-facing routes). */
export async function withTier(
  req: Request, rule: Rule,
  fn: (store: Store, tier: Tier, me: Me) => Response | Promise<Response>,
  { headers, bot = true }: { headers?: HeadersInit; bot?: boolean } = {},
): Promise<Response> {
  const me = await getMe();
  // P6: BotID and the rate limit run side by side; the store loads only after both pass (a refused request costs nothing)
  const [botRefused, limited] = await Promise.all([bot ? botCheck() : null, rateLimit(rule, clientKey(req, me.user?.id))]);
  const refused = botRefused ?? limited;
  if (refused) return noStore(refused);
  const store = await loadStore(me.tier, headers);
  if (store instanceof Response) return store;
  return noStore(await fn(can(me.tier, "exact_edge") ? store : freeView(store), me.tier, me));   // RT-04: Free filters on what it sees
}

/** Server Components: the honest "first update shortly" line when Free has no delayed scan yet; any other error rethrows. */
export function pendingLine(e: unknown): string {
  if (e instanceof DelayedPending) return delayedPendingLine(delayMin("free"));
  throw e;
}

/** A page load refused by pageStore / pageBudget (RT3-02): the page renders its "slow down" state. */
export class SlowDown extends Error {
  constructor() { super("rate limited"); }
}

/** RT3-02: /m/[id] and /event/[id] page loads carry the same data as /api/markets/[id] and /api/events/[id], so they
 *  get the same `markets` rate limit (keyed like the API: user id, else platform IP), checked before the store load.
 *  Throws SlowDown when refused. Wrap the page's load() in React cache() so generateMetadata and the page count once. */
export async function pageStore(): Promise<{ store: Store; tier: Tier; me: Me; req: Request; bot: boolean }> {
  const [me, h, bot] = await Promise.all([getMe(), headers(), verifiedBot()]);
  const req = new Request("http://page/", { headers: h });
  if (!bot && (await rateLimit("markets", clientKey(req, me.user?.id)))) throw new SlowDown();
  return { store: await getStoreFor(me.tier), tier: me.tier, me, req, bot };
}

/** RT3-02: Free / signed-out page loads count the markets they show against the RT-03 distinct-row budget
 *  (FREE_ROWS_PER_HOUR, shared with the list routes). Throws SlowDown past it. Paid tiers: no budget, like the API. */
export async function pageBudget({ tier, me, req, bot }: { tier: Tier; me: Me; req: Request; bot?: boolean }, ids: string[]): Promise<void> {
  if (can(tier, "live_data") || bot) return;   // verified search bots: owner decision, see verifiedBot()
  if (await rowBudget(req, me.user?.id, ids)) throw new SlowDown();
  await noteRows(req, me.user?.id, ids.length);
}

export const notFound =(what: string, headers?: HeadersInit) => Response.json({ error: `${what} not found` }, { status: 404, headers });

/** One page for the API. When q finds nothing, relax it step by step (docs/13 § honest fallback) and say so. */
export function marketsPage(store: Store, f: FilterState): MarketsResponse {
  let page = apply(store, f);
  const orig = page.parsed;
  if (page.total === 0 && orig) {
    let p: ParsedQuery = orig;
    for (const step of RELAX_STEPS) {
      const next = relax(p, step);
      if (!next) continue;
      p = next;
      const tried = apply(store, f, undefined, p);
      if (tried.total > 0) {
        page = { ...tried, search: { chips: orig.chips, relaxed: relaxedNote(orig, p) } };
        break;
      }
    }
  }
  const { parsed: _parsed, ...rest } = page;
  let start = 0;
  const groups = rest.groups?.map(({ rows, best: _best, ...g }) => {
    const out = { ...g, start, count: rows.length };
    start += rows.length;
    return out;
  });
  return { ...rest, groups };
}

const byRoi = (a: StoreMarket, b: StoreMarket) => b.best.roi_pct - a.best.roi_pct || a.closes_at - b.closes_at;

/** First `rowCap(tier)` items (Free: 10 rows per request by default, docs/08; site settings can change it). */
const capRows = <T,>(list: T[], tier: Tier) => list.slice(0, rowCap(tier));

/** Open markets of one event; null once every one has closed (routes answer 404). */
export function eventBody(store: Store, markets: StoreMarket[], tier: Tier = "premium"): EventResponse | null {
  const sorted = openOnly(markets, nowFor(store)).sort(byRoi);
  const m = sorted[0];
  if (!m) return null;
  return {
    event_id: m.event_id, event: m.event, slug: m.slug,
    markets: capRows(sorted, tier).map((x) => gateMarket(x, tier)),
    flags: capRows(sorted.flatMap((x) => store.flagsById.get(x.id) ?? []), tier).map((x) => gateMarket(x, tier)),
  };
}

/** /api/markets/[id] and the /m/[id] page. `shown` = the tier the market itself is shaped for (a Free reveal = "pro"). */
const NONE: LedgerStats = { entries: 0, graded: 0, wins: 0, losses: 0, avg_pnl: null, avg_clv: null };
/** T-290: a category's test record beside the same category's live record (best bets only, like the ledger). */
export function categoryProof(store: Store, cat: string): Proof {
  const l = store.ledgerSummary;
  return proofLine({
    record: categoryRecord(store.backtest, cat), backtest: store.backtest,
    live: l ? (l.by_category[cat] ?? NONE) : null, since: store.ledgerSince, updatedAt: l?.updated_at, who: `${cat} best bets`,
  });
}

export function marketBody(store: Store, m: StoreMarket, tier: Tier, shown: Tier = tier, live?: Map<string, StoreMarket>): MarketResponse {
  const segment = segmentOf(m);
  const at = (x: StoreMarket) => live?.get(x.id) ?? x;
  return {
    market: gateMarket(at(store.flagsById.get(m.id) ?? m), shown),   // the flag row carries best.realistic_edge
    segment,
    curve: can(shown, "exact_edge") ? curve(store.model, segment, m.horizon_h) : null,   // RT3-01: curve + mid = exact win chance
    backtest: categoryRecord(store.backtest, m.category),
    proof: categoryProof(store, m.category),
    event_markets: siblings(store, m, tier).map((x) => gateMarket(at(x), tier)),
  };
}

const siblings = (store: Store, m: StoreMarket, tier: Tier) =>
  capRows(openOnly(store.byEvent.get(m.event_id) ?? [], nowFor(store)).filter((x) => x.id !== m.id), tier);

/** The drawer / market page body at live prices for live tiers (lib/reprice.ts). Gated on the caller's real tier, never
 *  on `shown`: a Free reveal shows exact numbers, but from the delayed scan. */
export async function liveMarketBody(store: Store, m: StoreMarket, tier: Tier, shown: Tier = tier): Promise<MarketResponse> {
  if (!can(tier, "live_data") || !repriceOn()) return marketBody(store, m, tier, shown);
  const own = store.flagsById.get(m.id) ?? m;
  const { markets, at } = await repriceMarkets([own, ...siblings(store, m, tier)], ctxOf(store), quoteSource());
  const body = marketBody(store, m, tier, shown, new Map(markets.map((x) => [x.id, x])));
  return at === undefined ? body : { ...body, price_at: at };
}

/** 32-bit FNV-1a: a cheap, stable hash for the Free daily sample (not a secret, only a shuffle). */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** docs/19 P3: Free sees FREE_BEST_BETS_A_DAY (10) Best bets a day, a random sample per user (or IP) per UTC day, so a
 *  refresh doesn't change it. Drawn from the unfiltered Best bets list (lib/data/counts.ts, the same rows every count
 *  uses), so the default page shows exactly 10 whenever 10 exist. Consistent sampling: each bet ranks by
 *  hash(key + day + id) and the lowest N win, so a new scan only swaps the bets that closed or appeared. Fixed, never
 *  the admin free_rows setting: that one is rows per list request. */
export function freeSample(store: Store, key: string, now = Date.now()): Set<string> {
  const seed = `${key}|${new Date(now).toISOString().slice(0, 10)}|`;
  return new Set(
    bestBetsRows(store, { us: freeUsOn(store) })
      .map((r) => [fnv(seed + r.market.id), r.market.id] as const)
      .sort((a, b) => a[0] - b[0])
      .slice(0, FREE_BEST_BETS_A_DAY)
      .map(([, id]) => id),
  );
}

/** Free Best bets: every match is counted (`total` is the real N for "Unlock all N bets"), but only the day's sample
 *  leaves the server, ungrouped (a game group would carry the other bets in it). `free_daily` marks the page as the
 *  Free sample, so the client draws the locked cards from the server's answer, never from its own guess of the tier. */
function freeFlagsPage(store: Store, f: FilterState, key: string): MarketsResponse {
  const page = marketsPage(store, { ...f, us: f.us && freeUsOn(store), page: 1, page_size: Number.MAX_SAFE_INTEGER, group_by_event: false });
  const keep = freeSample(store, key);
  const rows = page.rows.filter((r) => keep.has(r.market.id));
  return { ...page, page_size: f.page_size, total_groups: undefined, groups: undefined, rows, free_daily: FREE_BEST_BETS_A_DAY };
}

/** Live re-pricing (lib/reprice.ts) is off for a frozen snapshot (DATA_CLOCK=scan: tests, demo fixtures), under
 *  Vitest, and with LIVE_REPRICE=0. Tests turn it on with `_setReprice`. */
let repriceForced: QuoteSource | null = null;
export const _setReprice = (source: QuoteSource | null) => void (repriceForced = source);
const repriceOn = () => !!repriceForced || (process.env.LIVE_REPRICE !== "0" && process.env.DATA_CLOCK !== "scan" && !process.env.VITEST);
const quoteSource = () => repriceForced ?? livePrices;

/** The /api/markets and /api/flags body for one request, after rate limits. Shared with the server render of
 *  Best bets (firstPage) so the first paint and the API return the same rows and count.
 *  null = a paid page past the last one. */
export async function listBody(store: Store, f: FilterState, tier: Tier, sampleKey: string): Promise<MarketsResponse | null> {
  const body = await listBodyOf(store, f, tier, sampleKey);
  return body && { ...body, scanned_at: store.meta.scanned_at };   // QA-A #46: rows carry their scan
}

async function listBodyOf(store: Store, f: FilterState, tier: Tier, sampleKey: string): Promise<MarketsResponse | null> {
  const live = can(tier, "live_data");
  const page = live ? marketsPage(store, f) : f.view === "flags" ? freeFlagsPage(store, f, sampleKey) : marketsPage(store, { ...f, page: 1 });
  if (live && f.page > Math.max(1, page.pages)) return null;
  if (!live) return gateMarkets(page, tier, page.free_daily);   // Free stays 15 min behind; its Best bets are the day's sample
  if (!repriceOn()) return gateMarkets(page, tier);
  const want = tierOf(f);
  // Best bets drops bets that lost their edge or tier; All markets keeps every row (a lost edge only clears its flag)
  const keep = f.view === "flags" ? (t: "best" | "edge") => want === "all" || t === want : undefined;
  const priced = await repricePage(page, ctxOf(store), keep, quoteSource());
  // T-288: the count is the scan's (lib/data/counts), the same on every page, reload and surface. Live prices can hide
  // a card on this page that lost its edge, but they price only this page, so they don't move the one count.
  return gateMarkets(f.view === "flags" ? { ...priced, total: page.total, total_groups: page.total_groups } : priced, tier);
}

const sampleKeyOf = (req: Request, me: Me) => (me.user?.id ? `u:${me.user.id}` : `ip:${clientIp(req)}`);

/** GET /api/markets and /api/flags. Free: first page only (top 10 rows), exact numbers as ranges (docs/08 LIMITS);
 *  Best bets are the day's sample (freeSample). Paid: a page past the last one is refused (docs/15 § pagination cap). */
export const listRoute = (req: Request, view?: "flags") =>
  withTier(req, "markets", async (store, tier, me) => {
    const f = { ...parse(new URL(req.url).searchParams), ...(view ? { view } : {}) };
    const live = can(tier, "live_data");
    if (live && f.page > 1) {
      const refused = await rateLimit("pages", clientKey(req, me.user?.id));   // max 50 pages a minute
      if (refused) return refused;
    }
    if (!live) {
      const refused = await rateLimit("list_free", clientKey(req, me.user?.id));   // RT-03: 30 a minute
      if (refused) return refused;
    }
    const body = await listBody(store, f, tier, sampleKeyOf(req, me));
    if (!body) return Response.json({ error: "page is past the last page" }, { status: 400 });
    const over = live ? null : await rowBudget(req, me.user?.id, body.rows.map((r) => r.market.id));   // RT-03
    if (over) return over;
    await noteRows(req, me.user?.id, body.rows.length);
    return Response.json(body);
  });

/** Best bets page 1 for the first server paint (docs/19 P6): the same body /api/flags returns for this URL (same
 *  store, gate, Free sample and live prices), so the page needs no client fetch and the headline count matches the
 *  cards. Counts against the same `markets` rate limit and Free row budget as a page load (pageStore / pageBudget).
 *  undefined when it can't match the browser's query (fav/wl resolve on the device), when refused, or on any
 *  failure: the browser then fetches /api/flags as before. */
/** P6: the server-rendered first page for a screener URL (same body as /api/flags or /api/markets), so the cards ship
 *  with the HTML and no protected fetch (BotID challenge) runs on a plain page load. Best bets also gets its
 *  "Closing soon" strip. undefined (the client fetches as before) for "Mine" filters, which resolve in the browser,
 *  or on any error. Free page loads count every row shown against the row budget, like the API. */
export async function firstPage(params: URLSearchParams, view: "flags" | "markets"): Promise<{ main: MarketsResponse; soon?: MarketsResponse; scanned_at: number } | undefined> {
  if (params.has("fav") || params.has("wl")) return undefined;
  try {
    const ctx = await pageStore();
    const store = can(ctx.tier, "exact_edge") ? ctx.store : freeView(ctx.store);
    const f = parse(params);
    const key = sampleKeyOf(ctx.req, ctx.me);
    const state = view === "flags"
      ? { ...f, view: "flags" as const, verdicts: params.has("vd") ? f.verdicts : BEST_BETS_VERDICTS, page: 1 }
      : { ...f, page: 1 };
    const [main, soon] = await Promise.all([
      listBody(store, state, ctx.tier, key),
      view === "flags" ? listBody(store, { ...state, ...CLOSING_SOON } as FilterState, ctx.tier, key) : undefined,
    ]);
    if (!main) return undefined;
    await pageBudget(ctx, [...main.rows, ...(soon?.rows ?? [])].map((r) => r.market.id));
    return { main, soon: soon ?? undefined, scanned_at: store.meta.scanned_at };   // the scan this tier sees, like /api/meta
  } catch {
    return undefined;
  }
}
