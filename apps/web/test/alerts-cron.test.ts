// T-45: server alert evaluator over a mocked Supabase + mocked email.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketsResponse } from "@/lib/api";
import type { Market, Side } from "@/lib/types";
import { fakeSupabase } from "./fakeSupabase";

const sendEmail = vi.fn(async (_e: { to: string; html: string; text: string; unsubscribeUrl: string }) => ({ sent: true }));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail: (e: never) => sendEmail(e) }));

const { runServerAlerts, webhookUrl } = await import("@/lib/alerts-server");

const side = (i: 0 | 1): Side => ({
  side_index: i, outcome: i ? "No" : "Jaguars", ask: 0.72, mid: 0.715, fee: 0.01, win_prob: 0.79, win_prob_low: 0.76,
  edge: 0.06, edge_low: 0.03, roi_pct: 7.2, model_level: "nmt", model_neff: 800, model_events: 190,
});
const market = (id: string): Market => ({
  id, question: `Q ${id}`, event: "E", event_id: "e", slug: "s", url: "u", tokens: ["1", "2"], category: "sports", niche: "nfl",
  market_type: "moneyline", tags: [], hours_to_close: 30, closes_at: 1795370400, horizon_h: 24, volume: 1, liquidity: 1, spread: 0.01,
  validated: true, backtest: null, sides: [side(0), side(1)], best: side(0),
});
const page = (ids: string[]): MarketsResponse =>
  ({ total: ids.length, page: 1, page_size: 50, pages: 1, rows: ids.map((id) => ({ market: market(id) as never, side: side(0) })), facets: {} as never });
const src = (ids = ["a"]) => ({
  fetchMarkets: async () => page(ids),
  fetchMarket: async (id: string) => market(id),
  fetchBook: async () => null,
});
const rule = (o: Record<string, unknown> = {}) => ({
  id: "r1", user_id: "u1", name: "Loose", enabled: true, kind: "preset_match", query: { v: 1 }, market_id: null, side_index: null,
  threshold: 1, channels: ["email"], webhook_url: null, cooldown_minutes: 60, quiet_hours: null, last_fired_at: null, created_at: "", ...o,
});
const db = (rules: Record<string, unknown>[], tier = "pro", tz = "UTC") => fakeSupabase({
  alert_rules: rules,
  profiles: [{ user_id: "u1", timezone: tz, odds_format: "cents" }],
  subscriptions: [{ user_id: "u1", tier }],
  alert_events: [], watchlist: [],
}, { u1: "trader@example.test" });
const NOON = new Date("2026-11-16T12:00:00Z");

beforeEach(() => { vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret"); sendEmail.mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("alerts cron (T-45)", () => {
  it("fires once, emails with a one-click unsubscribe link, and a second run is a no-op", async () => {
    const d = db([rule()]);
    const first = await runServerAlerts(d as never, src(), NOON);
    expect(first).toMatchObject({ users: 1, events: 1, emails: 1, errors: 0 });
    const mail = sendEmail.mock.calls[0]![0];
    expect(mail.to).toBe("trader@example.test");
    expect(mail.unsubscribeUrl).toMatch(/\/api\/unsubscribe\?t=/);
    expect(mail.html).toContain(mail.unsubscribeUrl.replace(/&/g, "&amp;"));
    expect(mail.text).toContain(mail.unsubscribeUrl);
    expect(d.tables.alert_events).toHaveLength(1);
    expect(d.tables.alert_events![0]).toMatchObject({ user_id: "u1", rule_id: "r1", market_id: "a", sent_channels: ["in_app", "email"] });
    expect(d.tables.alert_rules![0]!.last_fired_at).toBe(NOON.toISOString());

    const again = await runServerAlerts(d as never, src(), NOON);
    expect(again.events).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(d.tables.alert_events).toHaveLength(1);
  });

  it("dedupe_key stops a repeat in the same cooldown bucket even when memory is lost", async () => {
    const d = db([rule({ kind: "market_price", market_id: "a", side_index: 0, threshold: 0.8, channels: [] })]);
    const live = { ...src(), fetchBook: async () => ({ book_ok: true, best_ask: 0.7, net_edge: 0.05, fee_at_ask: 0.01 }) as never };
    expect((await runServerAlerts(d as never, live, NOON)).events).toBe(1);
    expect((await runServerAlerts(d as never, live, new Date(NOON.getTime() + 5 * 60_000))).events).toBe(0);
    expect(d.tables.alert_events).toHaveLength(1);
  });

  it("honors quiet hours in the user's timezone", async () => {
    const d = db([rule({ quiet_hours: [22, 7] })], "pro", "America/New_York");   // 12:00Z = 07:00 New York: awake
    const night = db([rule({ quiet_hours: [22, 8] })], "pro", "America/New_York"); // 07:00 is inside [22, 8)
    expect((await runServerAlerts(night as never, src(), NOON)).events).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await runServerAlerts(d as never, src(), NOON)).events).toBe(1);
  });

  it("skips disabled rules and free-tier users", async () => {
    expect((await runServerAlerts(db([rule({ enabled: false })]) as never, src(), NOON)).events).toBe(0);
    expect((await runServerAlerts(db([rule()], "free") as never, src(), NOON)).events).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("posts webhooks only for Premium and only to the allowed prefixes", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { posts.push(u); return new Response("{}", { status: 200 }); }));
    const hook = "https://discord.com/api/webhooks/1/abc";
    await runServerAlerts(db([rule({ channels: ["discord"], webhook_url: hook })], "pro") as never, src(), NOON);
    expect(posts).toEqual([]);
    const d = db([rule({ channels: ["discord"], webhook_url: hook })], "premium");
    const c = await runServerAlerts(d as never, src(), NOON);
    expect(posts).toEqual([hook]);
    expect(c.webhooks).toBe(1);
    expect(d.tables.alert_events![0]!.sent_channels).toEqual(["in_app", "discord"]);
    posts.length = 0;
    await runServerAlerts(db([rule({ channels: ["discord"], webhook_url: "https://evil.test/api/webhooks/x" })], "premium") as never, src(), NOON);
    expect(posts).toEqual([]);
    expect(webhookUrl("discord", "https://discord.com/api/webhooks/../../evil")).toBeNull();
    expect(webhookUrl("telegram", "https://api.telegram.org.evil.test/bot1/sendMessage")).toBeNull();
    expect(webhookUrl("telegram", "https://api.telegram.org/bot1:x/sendMessage?chat_id=5")).not.toBeNull();
  });
});
