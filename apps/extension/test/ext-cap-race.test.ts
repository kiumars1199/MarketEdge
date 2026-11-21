// RT-06 regression (from ops/redteam/ext-cap-race.test.ts): the real background.ts with a stubbed chrome.*, a
// mocked vault (key present) and a mocked Kalshi client. Concurrent `place` intents, each with its own valid nonce,
// must not get past the daily cap together.
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const placed: unknown[] = [];
vi.mock("../src/kalshi/vault", () => ({
  loadKey: async () => ({ keyId: "k", key: {}, type: "ed25519", scopes: ["read", "write::trade"], verifiedAt: 1 }),
  saveKey: async () => {}, deleteKey: async () => {}, maskId: (s: string) => s,
}));
vi.mock("../src/kalshi/client", () => ({
  KalshiError: class extends Error {},
  placeOrder: async (_s: unknown, o: unknown) => { await new Promise((r) => setTimeout(r, 20)); placed.push(o); return { order_id: `o${placed.length}` }; },
}));

const local: Record<string, unknown> = { caps: { maxOrderUsd: 25, maxDayUsd: 25 } };
let external: (msg: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;
const badNonces = new Set<string>();

beforeAll(async () => {
  const area = (store: Record<string, unknown>) => ({
    get: async (k: string) => ({ [k]: store[k] }), set: async (o: Record<string, unknown>) => void Object.assign(store, o), remove: async () => {},
  });
  (globalThis as any).chrome = {
    runtime: {
      id: "me", getManifest: () => ({ version: "0" }), getURL: (p: string) => `chrome-extension://me/${p}`,
      onMessageExternal: { addListener: (f: typeof external) => { external = f; } }, onMessage: { addListener: () => {} },
    },
    storage: { local: area(local), session: area({}), onChanged: { addListener: () => {} } },
    sidePanel: { open: async () => {} },
  };
  // the server's nonce check: every nonce is valid and user-confirmed unless listed in badNonces
  (globalThis as any).fetch = async (_u: string, init: { body: string }) => {
    const ok = !badNonces.has(JSON.parse(init.body).nonce);
    return { ok: true, json: async () => ({ ok }) };
  };
  await import("../src/background");
});

beforeEach(() => { local.spend = { day: "2000-01-01", cents: 0 }; placed.length = 0; badNonces.clear(); });

const send = (n: number) => new Promise<any>((resolve) => external({
  type: "place", nonce: `nonce-${n}`,
  order: { ticker: "KXTEST-1", side: "yes", price_cents: 50, count: 40, client_order_id: `3f1c2a9e-1b2c-4d5e-8f90-12345678900${n}` },
}, { origin: "http://localhost:3000" }, resolve));

it("RT-06: three concurrent $20.70 orders against a $25/day cap: one placed, spend within the cap", async () => {
  const results = await Promise.all([send(3), send(4), send(5)]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(placed).toHaveLength(1);
  expect((local.spend as { cents: number }).cents).toBeLessThanOrEqual(2500);
});

it("RT-06: an order refused before it reaches Kalshi releases its reservation", async () => {
  badNonces.add("nonce-6");
  expect((await send(6)).ok).toBe(false);
  expect(placed).toHaveLength(0);
  expect(((local.spend as { cents: number }).cents)).toBe(0);
  expect((await send(7)).ok).toBe(true);   // the cap still has room for the next real order
  expect(placed).toHaveLength(1);
});
