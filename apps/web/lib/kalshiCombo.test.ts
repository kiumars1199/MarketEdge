import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCombo } from "./kalshiCombo";

const hb = vi.hoisted(() => ({ tier: "premium" as "free" | "pro" | "premium" }));
vi.mock("@/lib/auth/server", async (orig) => ({ ...(await orig<object>()), getMe: async () => ({ user: null, tier: hb.tier, beta: false }) }));

const BASE = "https://k.test/v2";
function fake(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(`${BASE}${k}`));
    return key ? new Response(JSON.stringify(routes[key])) : new Response("{}", { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const legs = [{ ticker: "KXA-1", side: "yes" as const }, { ticker: "KXB-2", side: "no" as const }];

describe("Kalshi combo check", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("finds the collection, looks up the combo market and reads its ask", async () => {
    const { f, calls } = fake({
      "/markets/KXA-1": { market: { event_ticker: "EVA" } },
      "/markets/KXB-2": { market: { event_ticker: "EVB" } },
      "/multivariate_event_collections?": { multivariate_contracts: [
        { collection_ticker: "OTHER", associated_events: [{ ticker: "EVA" }] },
        { collection_ticker: "KXMVE", associated_events: [{ ticker: "EVA" }, { ticker: "EVB" }] },
      ] },
      "/multivariate_event_collections/KXMVE/lookup": { market_ticker: "KXMVE-COMBO-1", event_ticker: "KXMVE-E" },
      "/markets/KXMVE-COMBO-1": { market: { yes_ask: 23 } },
    });
    expect(await lookupCombo({ legs }, f, BASE)).toEqual({ ok: true, ticker: "KXMVE-COMBO-1", ask_cents: 23 });
    const lookup = calls.find((c) => c.url.endsWith("/lookup"))!;
    expect(lookup.init?.method).toBe("POST");
    expect(JSON.parse(String(lookup.init?.body))).toEqual({ selected_markets: [
      { event_ticker: "EVA", market_ticker: "KXA-1", side: "yes" },
      { event_ticker: "EVB", market_ticker: "KXB-2", side: "no" },
    ] });
  });

  it("refuses same-event legs and reports a missing collection or network failure", async () => {
    const same = fake({ "/markets/": { market: { event_ticker: "EVA" } } });
    expect(await lookupCombo({ legs }, same.f, BASE)).toMatchObject({ ok: false, error: expect.stringContaining("share a Kalshi event") });
    const none = fake({ "/markets/KXA-1": { market: { event_ticker: "EVA" } }, "/markets/KXB-2": { market: { event_ticker: "EVB" } }, "/multivariate_event_collections?": { multivariate_contracts: [] } });
    expect(await lookupCombo({ legs }, none.f, BASE)).toMatchObject({ ok: false, error: expect.stringContaining("no combo") });
    const down = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await lookupCombo({ legs }, down, BASE)).toMatchObject({ ok: false });
  });

  it("route: Premium (Combos) with KALSHI_DATA_PERMISSION=true only; origin-checked and validated", async () => {
    const { GET, POST } = await import("@/app/api/combos/kalshi/route");
    const req = () => new Request("http://localhost/api/combos/kalshi", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ legs }) });
    expect(await (await GET()).json()).toEqual({ enabled: false });   // flag off: off even for Premium
    expect((await POST(req())).status).toBe(404);
    hb.tier = "pro";
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    expect(await (await GET()).json()).toEqual({ enabled: false });   // no Combos on Pro
    expect((await POST(req())).status).toBe(404);
    hb.tier = "premium";
    expect(await (await GET()).json()).toEqual({ enabled: true });
    expect((await POST(new Request("http://localhost/api/combos/kalshi", { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" }))).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/combos/kalshi", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ legs: [legs[0]] }) }))).status).toBe(400);
  });
});
