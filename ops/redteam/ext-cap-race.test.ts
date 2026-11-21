// RT-06 / RT-07 repro. Copy to apps/extension/test/ and run `pnpm exec vitest run test/ext-cap-race.test.ts`.
// Loads the real background.ts with a stubbed chrome.*, a mocked vault (key present) and a mocked Kalshi client,
// then sends two `place` intents at once from our origin, each with its own valid server nonce.
import { beforeAll, expect, it, vi } from "vitest";
import { scopeError } from "../src/kalshi/trade";

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
  // the server's nonce check: every nonce here is a distinct, valid, user-confirmed one
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  await import("../src/background");
});

const send = (n: number) => new Promise<any>((resolve) => external({
  type: "place", nonce: `nonce-${n}`,
  order: { ticker: "KXTEST-1", side: "yes", price_cents: 50, count: 40, client_order_id: `3f1c2a9e-1b2c-4d5e-8f90-12345678900${n}` },
}, { origin: "http://localhost:3000" }, resolve));

it("RT-06: two concurrent $20.70 orders both pass a $25/day cap", async () => {
  const sequentialFirst = await send(1);
  const blocked = await send(2);   // sequential: second is refused, the cap works
  expect(sequentialFirst.ok).toBe(true);
  expect(blocked.ok).toBe(false);
  // next day, fired together
  local.spend = { day: "2000-01-01", cents: 0 };
  placed.length = 0;
  const [a, b, c] = await Promise.all([send(3), send(4), send(5)]);
  console.log("concurrent results:", [a, b, c].map((r) => r.ok), "orders placed:", placed.length, "spend recorded (cents):", (local.spend as any).cents);
  expect(placed.length).toBe(3);   // $62.10 placed against a $25 daily cap
});

it("RT-07: scope deny-list accepts keys with other money-moving scopes", () => {
  for (const s of [["read", "write::trade", "WRITE::TRANSFER"], ["read", "write::trade", "transfer"], ["read", "write::trade", "write:transfer"], ["read", "write::trade", "admin"]])
    console.log(JSON.stringify(s), "->", scopeError(s) ?? "ACCEPTED");
  expect(scopeError(["read", "write::trade", "WRITE::TRANSFER"])).toBeNull();
});
