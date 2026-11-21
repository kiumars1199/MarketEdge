// #23/#64 (Marc, Nov 20): Pro email alerts end to end through the real sendEmail, with Resend's HTTP API stubbed
// (no real sends). alerts-cron.test.ts mocks sendEmail itself; this file proves the cron → Resend request path, and the
// editor's channel helpers that put "email" on a rule in the first place.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelWords, toggleChannel } from "@/components/alerts/AlertsView";
import { dedupeKey } from "@/lib/alerts";
import { runServerAlerts } from "@/lib/alerts-server";
import type { MarketsResponse } from "@/lib/api";
import type { Market, Side } from "@/lib/types";
import { fakeSupabase } from "./fakeSupabase";

const side = (i: 0 | 1): Side => ({
  side_index: i, outcome: i ? "No" : "Jaguars", ask: 0.72, mid: 0.715, fee: 0.01, win_prob: 0.79, win_prob_low: 0.76,
  edge: 0.06, edge_low: 0.03, roi_pct: 7.2, model_level: "nmt", model_neff: 800, model_events: 190,
});
const market = (id: string): Market => ({
  id, question: `Q ${id}`, event: "E", event_id: "e", slug: "s", url: "u", tokens: ["1", "2"], category: "sports", niche: "nfl",
  market_type: "moneyline", tags: [], hours_to_close: 30, closes_at: 1795370400, horizon_h: 24, volume: 1, liquidity: 1, spread: 0.01,
  validated: true, backtest: null, sides: [side(0), side(1)], best: side(0),
});
const src = {
  fetchMarkets: async () => ({ total: 1, page: 1, page_size: 50, pages: 1, rows: [{ market: market("a") as never, side: side(0) }], facets: {} as never }) as MarketsResponse,
  fetchMarket: async (id: string) => market(id),
  fetchBook: async () => null,
};
const rule = (o: Record<string, unknown> = {}) => ({
  id: "r1", user_id: "u1", name: "Loose", enabled: true, kind: "preset_match", query: { v: 1 }, market_id: null, side_index: null,
  threshold: 1, channels: ["email"], webhook_url: null, cooldown_minutes: 60, quiet_hours: null, last_fired_at: null, created_at: "", ...o,
});
const db = (tier: string, events: Record<string, unknown>[] = []) => fakeSupabase({
  alert_rules: [rule()], profiles: [{ user_id: "u1", timezone: "UTC", odds_format: "percent" }],
  subscriptions: [{ user_id: "u1", tier }], alert_events: events, watchlist: [],
}, { u1: "bettor@example.test" });
const NOON = new Date("2026-11-16T12:00:00Z");

let resend: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Kismet <alerts@kismet.test>");
  resend = vi.fn(async () => Response.json({ id: "em_1" }));
  vi.stubGlobal("fetch", resend);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Pro email alerts through Resend (#23/#64)", () => {
  it("Pro: one Resend request with one-click unsubscribe, the disclaimer, no cents; the event records email", async () => {
    const d = db("pro");
    const c = await runServerAlerts(d as never, src, NOON);
    expect(c).toMatchObject({ events: 1, emails: 1, errors: 0 });
    expect(resend).toHaveBeenCalledTimes(1);
    const [url, init] = resend.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["bettor@example.test"]);
    expect(body.from).toBe("Kismet <alerts@kismet.test>");
    expect(body.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\/.+\/api\/unsubscribe\?t=.+>$/);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.text).toContain("Market analytics, not financial advice. Based on past results. 18+.");
    expect(body.text).toContain("pays 1.39x");
    expect(body.text).not.toMatch(/\d¢|cents/);   // rule 6
    expect(d.tables.alert_events![0]!.sent_channels).toEqual(["in_app", "email"]);
  });

  it("Free or lapsed plan: no request to Resend", async () => {
    expect((await runServerAlerts(db("free") as never, src, NOON)).emails).toBe(0);
    expect(resend).not.toHaveBeenCalled();
  });

  it("Resend not configured (no key or no sender): nothing sent and email is not claimed", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const d = db("pro");
    const c = await runServerAlerts(d as never, src, NOON);
    expect(c).toMatchObject({ events: 1, emails: 0, errors: 0 });
    expect(resend).not.toHaveBeenCalled();
    expect(d.tables.alert_events![0]!.sent_channels).toEqual(["in_app"]);
  });

  it("no UNSUBSCRIBE_SECRET: no email without an unsubscribe link; counted as an error, the event stays", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "");
    const d = db("pro");
    const c = await runServerAlerts(d as never, src, NOON);
    expect(c).toMatchObject({ events: 1, emails: 0, errors: 1 });
    expect(resend).not.toHaveBeenCalled();
    expect(d.tables.alert_events![0]!.sent_channels).toEqual(["in_app"]);
  });

  it("Resend refuses (HTTP 422): counted as an error, never claimed as sent", async () => {
    resend.mockImplementation(async () => new Response("{}", { status: 422 }));
    const d = db("pro");
    const c = await runServerAlerts(d as never, src, NOON);
    expect(c).toMatchObject({ emails: 0, errors: 1 });
    expect(d.tables.alert_events![0]!.sent_channels).toEqual(["in_app"]);
  });

  it("an alert the open tab already put in the bell (same dedupe key) is not emailed again", async () => {
    const key = dedupeKey({ id: "r1", cooldown_minutes: 60 }, "a", 0, NOON);
    const d = db("pro", [{ id: "e0", rule_id: "r1", user_id: "u1", market_id: "a", side_index: 0, dedupe_key: key, sent_channels: ["in_app"] }]);
    const c = await runServerAlerts(d as never, src, NOON);
    expect(c).toMatchObject({ events: 0, emails: 0 });
    expect(resend).not.toHaveBeenCalled();
  });
});

describe("alert editor channels (#23/#64)", () => {
  it("each switch turns only its own channel on or off", () => {
    expect(toggleChannel([], "email", true)).toEqual(["email"]);
    expect(toggleChannel(["email"], "push", true)).toEqual(["email", "push"]);
    expect(toggleChannel(["email", "push"], "push", false)).toEqual(["email"]);
    expect(toggleChannel(["push", "email"], "email", false)).toEqual(["push"]);
    expect(toggleChannel(["email"], "email", true)).toEqual(["email"]);
  });
  it("the rule line says where alerts go", () => {
    expect(channelWords([])).toBe("inbox");
    expect(channelWords(["push"])).toBe("inbox + browser");
    expect(channelWords(["email", "push"])).toBe("inbox + browser + email");
  });
});
