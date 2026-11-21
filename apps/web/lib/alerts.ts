// Alerts evaluator (docs/05 F-11, F-23; docs/10 demo deltas). Runs in the open tab in demo mode and
// on the server for signed-in users (lib/alerts-server.ts, /api/alerts/run).
// Pure over injected fetchers so it is unit-testable. Messages never say "bet this".
import type { MarketsResponse } from "@/lib/api";
import { closesIn, pct, ret } from "@/lib/format";
import { formatOdds } from "@/lib/odds";
import { FilterState } from "@/lib/filters/state";
import type { AlertEvent, AlertRule, OddsFormat, Repo } from "@/lib/repo/types";
import { UniqueViolation } from "@/lib/repo/types";
import type { Execution, Market, Side } from "@/lib/types";

export const KIND_LABEL: Record<AlertRule["kind"], string> = {
  preset_match: "New market in a view",
  market_price: "Price drops to a target",
  edge_change: "Estimated return crosses a level",
  closing_soon: "Market closing soon",
};

const bucket = (now: Date, cooldownMin: number) => Math.floor(now.getTime() / (Math.max(1, cooldownMin) * 60_000));
export const dedupeKey = (r: Pick<AlertRule, "id" | "cooldown_minutes">, marketId: string, side: 0 | 1 | null, now: Date) =>
  `${r.id}|${marketId}|${side ?? ""}|${bucket(now, r.cooldown_minutes)}`;

export function inQuietHours(r: Pick<AlertRule, "quiet_hours">, now: Date, timeZone: string): boolean {
  if (!r.quiet_hours) return false;
  const [a, b] = r.quiet_hours;
  let h: number;
  try { h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now)); }
  catch { h = now.getHours(); }
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

function closesAt(unixSec: number, timeZone: string): string {
  const d = new Date(unixSec * 1000);
  try { return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }); }
  catch { return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }); }
}

/** "Jaguars · pays 1.39x · won 79% before · estimated return +7% · closes Sun 1:00 PM" */
export function message(m: Market, s: Side, timeZone: string, live?: { ask: number; roi: number } | null, odds: OddsFormat = "percent"): string {
  const ask = live?.ask ?? s.ask;
  const roi = live?.roi ?? s.roi_pct;
  return [`${s.outcome} · pays ${odds === "american" ? formatOdds(ask, odds) : formatOdds(ask, "decimal")}`, `won ${pct(s.win_prob)} before`, `estimated return ${ret(roi)}`,
    m.closes_at ? `closes ${closesAt(m.closes_at, timeZone)} (${closesIn(m.closes_at)})` : null].filter(Boolean).join(" · ");
}
export const title = (m: Market) => `${m.niche.toUpperCase()} · ${m.question}`;

type Live = (Execution & { book_ok: true }) | null;
export interface Deps {
  repo: Repo;
  fetchMarkets: (q: FilterState) => Promise<MarketsResponse>;
  fetchMarket: (id: string) => Promise<Market | null>;
  fetchBook: (token: string, q: number, cat: string) => Promise<Live>;
  now?: Date;
  timeZone: string;
  odds?: OddsFormat;
  /** per-rule memory between runs in this tab: matched market keys (preset_match), last above/below (edge_change) */
  memory: Map<string, Set<string> | boolean>;
}

interface Hit { market: Market; side: Side; live?: { ask: number; roi: number } | null }
export const liveRoi = (x: Execution) => (x.net_edge / (x.best_ask + x.fee_at_ask)) * 100;

async function candidates(rule: AlertRule, d: Deps): Promise<Hit[]> {
  if (rule.kind === "preset_match") {
    const q = FilterState.safeParse(rule.query ?? {});
    if (!q.success) return [];
    const res = await d.fetchMarkets({ ...q.data, group_by_event: false, page: 1, page_size: 50 });
    const keys = res.rows.map((r) => `${r.market.id}|${r.side.side_index}`);
    const prev = d.memory.get(rule.id);
    d.memory.set(rule.id, new Set(keys));
    const fresh = res.rows.filter((r, i) => !(prev instanceof Set) || !prev.has(keys[i]!));
    return fresh.slice(0, Math.max(1, Math.min(10, rule.threshold ?? 1))).map((r) => ({ market: r.market, side: r.side }));
  }
  if (rule.kind === "closing_soon") {
    const ids = rule.market_id ? [rule.market_id] : [...new Set((await d.repo.watchlist.list()).map((w) => w.market_id))].slice(0, 20);
    const hours = rule.threshold ?? 6;
    const now = (d.now ?? new Date()).getTime() / 1000;
    const hits: Hit[] = [];
    for (const id of ids) {
      const m = await d.fetchMarket(id);
      if (!m || !m.closes_at) continue;
      const left = m.closes_at - now;
      if (left > 0 && left <= hours * 3600) hits.push({ market: m, side: m.sides[rule.side_index ?? m.best.side_index] ?? m.best });
    }
    return hits;
  }
  // market_price / edge_change: live book for the one token
  if (!rule.market_id || rule.threshold == null) return [];
  const m = await d.fetchMarket(rule.market_id);
  if (!m || m.closes_at * 1000 <= (d.now ?? new Date()).getTime()) return [];   // closed: no bet left to alert on
  const s = m.sides[rule.side_index ?? m.best.side_index] ?? m.best;
  const token = m.tokens[s.side_index];
  const x = token ? await d.fetchBook(token, s.win_prob, m.category) : null;
  if (!x) return [];
  const live = { ask: x.best_ask, roi: liveRoi(x) };
  if (rule.kind === "market_price") return x.best_ask <= rule.threshold ? [{ market: m, side: s, live }] : [];
  const above = live.roi >= rule.threshold;
  const before = d.memory.get(rule.id);
  d.memory.set(rule.id, above);
  const crossed = typeof before === "boolean" ? before !== above : above;   // first look: fire only when already above
  return crossed ? [{ market: m, side: s, live }] : [];
}

/** Evaluate enabled rules once. Returns the events it inserted (dedupe_key unique per cooldown bucket). */
export async function runRules(rules: AlertRule[], d: Deps): Promise<AlertEvent[]> {
  const now = d.now ?? new Date();
  const out: AlertEvent[] = [];
  for (const rule of rules) {
    if (!rule.enabled || inQuietHours(rule, now, d.timeZone)) continue;
    let hits: Hit[];
    try { hits = await candidates(rule, d); } catch { continue; }   // one bad rule never blocks the rest
    let fired = false;
    for (const h of hits.slice(0, 10)) {
      try {
        out.push(await d.repo.alert_events.insert({
          rule_id: rule.id, market_id: h.market.id, side_index: h.side.side_index,
          payload: { title: title(h.market), message: message(h.market, h.side, d.timeZone, h.live, d.odds), rule_name: rule.name, kind: rule.kind },
          sent_channels: ["in_app", ...(rule.channels.includes("push") ? ["push"] : [])],
          read_at: null, dedupe_key: dedupeKey(rule, h.market.id, h.side.side_index, now),
        }));
        fired = true;
      } catch (e) {
        if (!(e instanceof UniqueViolation)) throw e;   // already sent within the cooldown
      }
    }
    if (fired) await d.repo.alert_rules.update(rule.id, { last_fired_at: now.toISOString() });
  }
  return out;
}
