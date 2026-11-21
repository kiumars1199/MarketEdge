// trading-paper (docs/16 §3–4, docs/12): extension key vault → Trade ticket → resting limit order → cancel →
// marketable order → fill lands in My bets. Loads the real MV3 extension (built for this server's origin).
// Kalshi: if .env.local has KALSHI_DEMO_KEY_ID + KALSHI_DEMO_PRIVATE_KEY_PATH + KALSHI_DEMO_TICKER the flow runs
// against the real demo exchange; otherwise Kalshi is mocked at the network layer and every signed request's
// KALSHI-ACCESS-SIGNATURE is verified against the test key.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const PORT = Number(process.env.PW_PORT ?? 3100);
const ORIGIN = `http://localhost:${PORT}`;
const EXT_DIR = resolve(__dirname, "../../extension");
const OUT = join(EXT_DIR, "dist-e2e");
const EXT_ID = "cgoaaiaghbckpalppklocajbdpoelmbd"; // pinned by the dev key in the manifest

function envLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [resolve(__dirname, "../.env.local"), resolve(__dirname, "../../../.env.local")]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !out[m[1]!]) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const env = envLocal();
const REAL = !!(env.KALSHI_DEMO_KEY_ID && env.KALSHI_DEMO_PRIVATE_KEY_PATH && env.KALSHI_DEMO_TICKER);

/** Stateful stand-in for Kalshi's demo exchange: YES asks at 62¢, NO asks at 40¢. */
function mockKalshi(pub: KeyObject, keyId: string, ticker: string) {
  const orders = new Map<string, Record<string, unknown>>();
  const bad: string[] = [];
  const handle = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/trade-api/v2", "");
    const json = (status: number, body: unknown) => route.fulfill({ status, json: body });
    if (!path.startsWith("/markets/")) {
      const h = await req.allHeaders();
      const ok = h["kalshi-access-key"] === keyId &&
        verify(null, Buffer.from(`${h["kalshi-access-timestamp"]}${req.method()}${url.pathname}`), pub, Buffer.from(h["kalshi-access-signature"] ?? "", "base64"));
      if (!ok) { bad.push(`${req.method()} ${path}`); return json(401, { error: { message: "bad signature" } }); }
    }
    if (path === `/markets/${ticker}`) return json(200, { market: { ticker, title: "Test market on the demo exchange", status: "active", yes_ask: 62, no_ask: 40 } });
    if (path === `/markets/${ticker}/orderbook`) return json(200, { orderbook: { yes: [[60, 500]], no: [[38, 500]] } });
    if (path === "/api_keys") return json(200, { api_keys: [{ api_key_id: keyId, scopes: ["read", "write::trade"] }] });
    if (path === "/portfolio/balance") return json(200, { balance: 100000 });
    if (path === "/portfolio/positions") return json(200, { market_positions: [] });
    if (path === "/portfolio/orders" && req.method() === "GET") return json(200, { orders: [...orders.values()].filter((o) => o.status === "resting") });
    if (path === "/portfolio/events/orders" && req.method() === "POST") {
      const b = req.postDataJSON() as { ticker: string; side: "bid" | "ask"; count: string; price: string; client_order_id: string };
      const count = Number(b.count);
      const yes = Math.round(Number(b.price) * 100);
      // bid on YES fills at ≥ the YES ask (62); ask on YES (= buy NO) fills at ≤ the YES bid (60)
      const fills = b.side === "bid" ? yes >= 62 : yes <= 60;
      const paid = b.side === "bid" ? 0.62 : 0.4;
      const id = `ord-${orders.size + 1}-${b.client_order_id.slice(0, 8)}`;
      orders.set(id, {
        order_id: id, ticker: b.ticker, book_side: b.side, outcome_side: b.side === "bid" ? "yes" : "no",
        status: fills ? "executed" : "resting", fill_count_fp: fills ? `${count}.00` : "0.00", remaining_count_fp: fills ? "0.00" : `${count}.00`,
        taker_fill_cost_dollars: fills ? (count * paid).toFixed(4) : "0", maker_fill_cost_dollars: "0",
        taker_fees_dollars: fills ? (Math.ceil(7 * count * paid * (1 - paid)) / 100).toFixed(4) : "0", maker_fees_dollars: "0",
      });
      return json(201, { order_id: id, fill_count: fills ? b.count : "0.00", remaining_count: fills ? "0.00" : b.count });
    }
    const one = /^\/portfolio\/(?:events\/)?orders\/([^/]+)$/.exec(path);
    if (one) {
      const o = orders.get(decodeURIComponent(one[1]!));
      if (!o) return json(404, { error: { message: "not found" } });
      if (req.method() === "DELETE") { o.status = "canceled"; return json(200, {}); }
      return json(200, { order: o });
    }
    return json(404, { error: { message: `no mock for ${req.method()} ${path}` } });
  };
  return { handle, orders, bad };
}

const book = { book_ok: true, best_bid: 0.6, best_ask: 0.62, book_mid: 0.61, spread: 0.02, spread_cost: 0.01, fee_at_ask: 0.01, gross_edge: 0.1,
  net_edge: 0.08, retention: 0.8, capacity_usd: 5000, limit_price: 0.61, limit_edge: 0.09, verdict: "worth it", stakes: [], fetched_at: Date.now() };

test.describe.configure({ mode: "serial" });
let ctx: BrowserContext;

test.beforeAll(async () => {
  execFileSync("pnpm", ["build"], { cwd: EXT_DIR, env: { ...process.env, KISMET_ORIGIN: ORIGIN, OUT_DIR: "dist-e2e" }, stdio: "ignore" });
  ctx = await chromium.launchPersistentContext("", {
    channel: "chromium", baseURL: ORIGIN, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${OUT}`, `--load-extension=${OUT}`],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker");
  expect(new URL(sw.url()).host).toBe(EXT_ID);
});
test.afterAll(async () => { await ctx?.close(); });

test("trading-paper: connect key, resting order, cancel, marketable order, fill in My bets", async () => {
  test.setTimeout(120_000);
  let keyId: string, pem: string, ticker: string, kalshi: ReturnType<typeof mockKalshi> | null = null;
  if (REAL) {
    keyId = env.KALSHI_DEMO_KEY_ID!;
    pem = readFileSync(resolve(__dirname, "..", env.KALSHI_DEMO_PRIVATE_KEY_PATH!), "utf8");
    ticker = env.KALSHI_DEMO_TICKER!;
  } else {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    keyId = "e2e00000-0000-4000-8000-000000000001";
    pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    ticker = "KXE2E-26NOV18-T55";
    kalshi = mockKalshi(publicKey, keyId, ticker);
    await ctx.route("https://external-api.demo.kalshi.co/**", kalshi.handle);
  }
  await ctx.route("**/api/book*", (r) => r.fulfill({ json: book }));

  // 1. Connect the key in the extension's side panel ("Paper trading" tab).
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html#trade`);
  await panel.getByLabel("Key ID").fill(keyId);
  await panel.getByLabel("Private key").fill(pem);
  await panel.getByRole("button", { name: "Check and connect" }).click();
  await expect(panel.getByText("Demo key connected")).toBeVisible();
  await expect(panel.getByText("read · write::trade")).toBeVisible();
  await expect(panel.getByLabel("Private key")).toHaveCount(0); // the key is never shown again
  await snap(panel, "panel", { width: 400, height: 800 });

  // 2. Open a market, Trade → resting limit order (5¢ never fills).
  const page = await ctx.newPage();
  await page.goto("/");
  await page.locator("[data-row] h3 a").first().click();
  const drawer = page.getByRole("dialog", { name: "Market details" });
  const question = (await drawer.getByRole("heading").first().textContent())!.trim();
  const ticket = page.getByRole("dialog", { name: "Trade on Kalshi" });

  const open = async () => {
    await drawer.getByRole("button", { name: /^Trade/ }).click();
    await expect(ticket.getByText("Paper mode")).toBeVisible();
    await ticket.getByLabel("Kalshi market ticker").fill(ticker);
    await ticket.getByLabel("Kalshi market ticker").blur();
    if (!REAL) await expect(ticket.getByText("Test market on the demo exchange")).toBeVisible();
  };
  const placeAndConfirm = async () => {
    await ticket.getByRole("button", { name: "Review order" }).click();
    await expect(ticket.getByRole("heading", { name: "Confirm this paper order" })).toBeVisible();
    await ticket.getByRole("button", { name: "Place paper order" }).click();
  };

  await open();
  await ticket.getByLabel("Limit price in cents").fill("5");
  await ticket.getByLabel("Amount in dollars").fill("2");
  await expect(ticket.getByText(/wait on the book|it waits on the book/)).toBeVisible();
  await placeAndConfirm();
  const status = ticket.getByRole("region", { name: "Order status" });
  await expect(status.locator("[data-state]")).toHaveText("Waiting on the book", { timeout: 15_000 });

  // 3. Cancel it.
  await status.getByRole("button", { name: "Cancel order" }).click();
  await expect(status.locator("[data-state]")).toHaveText("Cancelled", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(ticket).toBeHidden();
  await expect(drawer).toBeVisible(); // Escape closes only the ticket, not the drawer under it

  // 4. Marketable order: limit prefilled at Kalshi's ask → fills now.
  await open();
  if (!REAL) await expect(ticket.getByText(/All fill now/)).toBeVisible();
  await ticket.getByLabel("Amount in dollars").fill("3");
  await snap(page, "ticket");
  await snap(page, "ticket-390", { width: 390, height: 844 });
  await snap(page, "ticket-1440", { width: 1440, height: 900 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await placeAndConfirm();
  await expect(status.locator("[data-state]")).toHaveText("Filled", { timeout: 30_000 });
  await expect(status.getByText("Fills added to")).toBeVisible();

  // 5. The fill is in My bets with its entry numbers.
  await status.getByRole("link", { name: "My bets" }).click();
  await expect(page).toHaveURL(/\/journal/);
  await expect(ticket).toBeHidden();
  await expect(page.getByText(question).first()).toBeVisible();
  await snap(page, "journal");

  if (kalshi) {
    expect(kalshi.bad).toEqual([]); // every signed request verified with the test key's public key
    const placed = [...kalshi.orders.values()];
    expect(placed.map((o) => o.status)).toEqual(["canceled", "executed"]);
  }
  if (SHOTS) {
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 320, height: 420 });
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await expect(popup.locator("#scan")).not.toHaveText("—");
    await snap(popup, "popup");
    await storeShots(popup);
  }
});

// SHOTS=1: review captures to SHOTS_DIR (default test-results/shots) and the 1280x800 store screenshots.
const SHOTS = !!process.env.SHOTS;
const SHOT_DIR = process.env.SHOTS_DIR ?? resolve(__dirname, "../test-results/shots");
const STORE_DIR = resolve(__dirname, "../../../docs/screenshots/store");
async function snap(p: Page, name: string, size?: { width: number; height: number }) {
  if (!SHOTS) return;
  if (size) await p.setViewportSize(size);
  await p.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

/** Chrome Web Store screenshots (1280x800): web captures as-is; extension pages framed with a caption. */
async function storeShots(p: Page) {
  const img = (n: string) => `data:image/png;base64,${readFileSync(join(SHOT_DIR, `${n}.png`)).toString("base64")}`;
  const frame = async (out: string, title: string, sub: string, imgs: string[]) => {
    await p.setViewportSize({ width: 1280, height: 800 });
    await p.setContent(`<body style="margin:0;width:1280px;height:800px;background:#070a09;color:#e6efe9;font:16px system-ui,sans-serif;display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box">
      <div style="flex:1"><div style="color:#10b981;font-weight:600;margin-bottom:12px">Kismet</div>
        <h1 style="font-size:40px;line-height:1.15;margin:0 0 16px;letter-spacing:-0.02em">${title}</h1><p style="color:#a9bab1;font-size:18px;line-height:1.5;margin:0">${sub}</p></div>
      ${imgs.map((s) => `<img src="${img(s)}" style="max-height:720px;border:1px solid #1a2520;border-radius:16px;box-shadow:0 20px 60px #0008">`).join("")}</body>`);
    await p.screenshot({ path: join(STORE_DIR, out) });
  };
  const copy = async (from: string, out: string) => {
    await p.setViewportSize({ width: 1280, height: 800 });
    await p.setContent(`<body style="margin:0"><img src="${img(from)}" style="display:block;width:1280px;height:800px"></body>`);
    await p.screenshot({ path: join(STORE_DIR, out) });
  };
  await copy("ticket", "1-paper-ticket.png");
  await copy("journal", "2-my-bets.png");
  await frame("3-key-vault.png", "Your Kalshi key stays in your browser", "Connect a trade-only demo key. It stays inside the extension, can't be exported, and signs only the orders you confirm.", ["panel"]);
  await frame("4-popup.png", "Sign-in, plan and status at a glance", "Open Kismet or the side panel from any tab.", ["popup"]);
}
