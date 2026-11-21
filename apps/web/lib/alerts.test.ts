import { describe, expect, it } from "vitest";
import type { MarketsResponse } from "@/lib/api";
import { LocalRepo } from "@/lib/repo/local";
import type { AlertRule } from "@/lib/repo/types";
import type { Market, Side } from "@/lib/types";
import { dedupeKey, inQuietHours, message, runRules, type Deps } from "./alerts";

const side = (i: 0 | 1): Side => ({
  side_index: i, outcome: i ? "No" : "Jaguars", ask: 0.72, mid: 0.715, fee: 0.01, win_prob: 0.79, win_prob_low: 0.76,
  edge: 0.06, edge_low: 0.03, roi_pct: 7.2, model_level: "nmt", model_neff: 800, model_events: 190,
});
const market = (id: string): Market => ({
  id, question: `Q ${id}`, event: "E", event_id: "e", slug: "s", url: "u", tokens: ["1", "2"], category: "sports", niche: "nfl",
  market_type: "moneyline", tags: [], hours_to_close: 30, closes_at: 1795370400, horizon_h: 24, volume: 1, liquidity: 1, spread: 0.01,
  validated: true, backtest: null, sides: [side(0), side(1)], best: side(0),
});
const page = (ids: string[]): MarketsResponse => ({ total: ids.length, page: 1, page_size: 50, pages: 1, rows: ids.map((id) => ({ market: market(id) as never, side: side(0) })), facets: {} as never });

function setup(ids: string[][]) {
  const repo = new LocalRepo();
  let call = 0;
  const deps: Deps = {
    repo, timeZone: "America/New_York", memory: new Map(), now: new Date("2026-11-16T12:00:00Z"),
    fetchMarkets: async () => page(ids[Math.min(call++, ids.length - 1)]!),
    fetchMarket: async (id) => market(id),
    fetchBook: async () => null,
  };
  return { repo, deps };
}
const rule = (o: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1", name: "Loose", enabled: true, kind: "preset_match", query: { v: 1 }, market_id: null, side_index: null, threshold: 1,
  channels: [], webhook_url: null, cooldown_minutes: 60, quiet_hours: null, last_fired_at: null, created_at: "", ...o,
});

describe("alerts", () => {
  it("same rule + market within cooldown creates one event", async () => {
    const { repo, deps } = setup([["a", "b"]]);
    expect(await runRules([rule()], deps)).toHaveLength(1);
    deps.memory.clear(); // even if the tab forgets what matched, dedupe_key stops a repeat
    expect(await runRules([rule()], deps)).toHaveLength(0);
    expect(await repo.alert_events.list()).toHaveLength(1);
    expect((await repo.alert_rules.list())).toHaveLength(0);
  });
  it("fires again for a newly matching market, and after the cooldown", async () => {
    const { repo, deps } = setup([["a"], ["a", "c"]]);
    await runRules([rule({ threshold: 5 })], deps);
    const second = await runRules([rule({ threshold: 5 })], deps);
    expect(second.map((e) => e.market_id)).toEqual(["c"]);
    deps.memory.clear();
    deps.now = new Date("2026-11-16T13:30:00Z");
    expect(await runRules([rule({ threshold: 5 })], deps)).toHaveLength(2);
    expect(await repo.alert_events.list()).toHaveLength(4);
  });
  it("disabled rule never fires", async () => {
    const { repo, deps } = setup([["a"]]);
    expect(await runRules([rule({ enabled: false })], deps)).toHaveLength(0);
    expect(await repo.alert_events.list()).toHaveLength(0);
  });
  it("dedupe key, quiet hours, message", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(dedupeKey(rule(), "m", 0, now)).toBe(`r1|m|0|${Math.floor(now.getTime() / 3_600_000)}`);
    expect(inQuietHours(rule({ quiet_hours: [22, 8] }), new Date("2026-11-16T04:00:00Z"), "America/New_York")).toBe(true);
    expect(inQuietHours(rule({ quiet_hours: [22, 8] }), new Date("2026-11-16T17:00:00Z"), "America/New_York")).toBe(false);
    const msg = message(market("m"), side(0), "America/New_York");
    expect(msg).toMatch(/^Jaguars · pays 1\.39x · won 79% before · estimated return \+7\.2% · closes Sun /);
    expect(msg.toLowerCase()).not.toMatch(/bet this|pick|lock/);
  });
});
