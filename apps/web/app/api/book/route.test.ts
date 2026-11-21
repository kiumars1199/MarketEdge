import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const book = (asset_id: string) => ({
  asset_id, bids: [{ price: "0.60", size: "1000" }], asks: [{ price: "0.62", size: "1000" }],
});
const get = (qs: string) => GET(new Request(`http://x/api/book?${qs}`));
afterEach(() => vi.unstubAllGlobals());

it("checks the live book, adds custom stake and warning, caches 5 s", async () => {
  const fetch = vi.fn(async () => Response.json([book("111")]));
  vi.stubGlobal("fetch", fetch);
  const res = await get("token=111&q=0.9&cat=constructor&stake=250");
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.verdict).toBe("worth it");
  expect(body.fee_at_ask).toBeCloseTo(0.05 * 0.62 * 0.38, 4); // unknown cat -> 0.05
  expect(body.stakes.map((s: { stake_usd: number }) => s.stake_usd)).toEqual([25, 100, 250, 500, 1000]);
  expect(body.warning).toMatch(/too good/);
  expect(typeof body.fetched_at).toBe("number");
  await get("token=111&q=0.5");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("400 on bad params, 502 on upstream failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
  expect((await get("token=abc&q=0.5")).status).toBe(400);
  expect((await get("token=222&q=2")).status).toBe(400);
  const res = await get("token=222&q=0.5");
  expect(res.status).toBe(502);
  expect((await res.json()).error).toMatch(/503/);
});

it("batch: best ask per token for the card price refresh, bounded to 24 ids", async () => {
  const fetch = vi.fn(async (_u: string, init: RequestInit) => {
    const [{ token_id }] = JSON.parse(String(init.body)) as { token_id: string }[];
    return Response.json(token_id === "333" ? [{ asset_id: "333", bids: [], asks: [] }] : [{ ...book(token_id), asks: [{ price: "0.71", size: "5" }, { price: "0.69", size: "9" }] }]);
  });
  vi.stubGlobal("fetch", fetch);
  const res = await get("tokens=444,333");
  expect(res.status).toBe(200);
  expect((await res.json()).asks).toEqual({ "444": 0.69, "333": null });
  expect((await get(`tokens=${Array.from({ length: 25 }, (_, i) => 500 + i).join(",")}`)).status).toBe(400);
  expect((await get("tokens=abc")).status).toBe(400);
  expect((await get("tokens=444&q=0.5")).status).toBe(400);   // strict: no extra keys
});
