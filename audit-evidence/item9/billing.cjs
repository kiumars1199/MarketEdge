const { chromium } = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@playwright/test");
const Stripe = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/stripe");
const { createHash, createHmac, randomUUID } = require("crypto");
const base = process.argv[2]; const SECRET = process.env.STRIPE_WEBHOOK_SECRET // the mock's fake secret, see setup/mock3160.sh;
async function retry(fn, ms = 90000) { const t = Date.now(); let e; while (Date.now() - t < ms) { try { return await fn(); } catch (x) { e = x; await new Promise(r => setTimeout(r, 1500)); } } throw e; }
const log = (...a) => console.log(...a);
async function signIn(browser, email) {
  const ctx = await browser.newContext({ baseURL: base }); const page = await ctx.newPage();
  await page.goto("/login?next=/pricing");
  await retry(async () => { await page.getByRole("tab", { name: "Email link" }).click(); await page.getByRole("button", { name: "Email me a sign-in link" }).waitFor({ timeout: 3000 }); });
  await page.getByLabel("Email", { exact: true }).fill(email); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor({ timeout: 60000 });
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  await page.goto(url);
  await retry(async () => { if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10000 }); await page.waitForURL(/\/pricing$/, { timeout: 10000 }); });
  return { ctx, page };
}
const tier = async (page) => (await (await page.request.get("/api/me")).json());
const exp = async (page) => (await (await page.request.get("/api/account/export")).json());
async function send(page, payloadObj, opts = {}) {
  const payload = JSON.stringify(payloadObj);
  const header = opts.header ?? Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? SECRET, timestamp: opts.timestamp });
  const r = await page.request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": header, "content-type": "application/json" } });
  return `${r.status()} ${await r.text()}`;
}
const evt = (type, object, id = `evt_audit_${randomUUID().slice(0, 8)}`) => ({ id, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } });
(async () => {
  const browser = await chromium.launch();
  // A. checkout -> webhook -> tier up
  const email = `audit4-bill-${Date.now()}@example.com`;
  const { ctx, page } = await signIn(browser, email);
  log("A0 before checkout:", (await tier(page)).tier);
  await page.goto("/pricing"); await page.getByTestId("checkout-pro").first().click(); await page.waitForURL(/\/account\?checkout=success/, { timeout: 60000 });
  const me = await tier(page); log("A1 after mock checkout + signed webhooks: tier", me.tier, "status", me.status, "period_end", me.current_period_end);
  const sub = (await exp(page)).subscription; log("   subscriptions row:", JSON.stringify(sub));
  const subId = sub.stripe_subscription_id, cus = sub.stripe_customer_id;
  const subObj = (await (await page.request.get(`/e2e-mock/stripe/v1/subscriptions/${subId}`)).json());
  // B. forged webhooks
  const premiumObj = { ...subObj, items: { ...subObj.items, data: [{ ...subObj.items.data[0], price: { id: "price_premium_m", object: "price" } }] } };
  log("B1 forged (wrong secret) subscription.updated → premium:", await send(page, evt("customer.subscription.updated", premiumObj), { secret: "not-the-secret" }), "tier now", (await tier(page)).tier);
  log("B2 unsigned:", await send(page, evt("customer.subscription.updated", premiumObj), { header: "" }), "tier now", (await tier(page)).tier);
  log("B3 garbage signature:", await send(page, evt("customer.subscription.updated", premiumObj), { header: "t=1,v1=deadbeef" }), "tier now", (await tier(page)).tier);
  log("B4 valid HMAC, timestamp 10 min old:", await send(page, evt("customer.subscription.updated", premiumObj), { timestamp: Math.floor(Date.now() / 1000) - 600 }), "tier now", (await tier(page)).tier);
  log("B5 valid signature but event body claims premium (tier re-read from Stripe, not the event):", await send(page, evt("customer.subscription.updated", premiumObj)), "tier now", (await tier(page)).tier);
  // C. replay / idempotency
  const e1 = evt("customer.subscription.updated", subObj);
  log("C1 first delivery:", await send(page, e1));
  log("C2 replay same event id:", await send(page, e1), "tier", (await tier(page)).tier);
  // D. portal cancel at period end -> stays pro; deleted -> free
  const scheduled = { ...subObj, cancel_at_period_end: true };
  log("D1 subscription.updated cancel_at_period_end=true:", await send(page, evt("customer.subscription.updated", scheduled)), "tier", (await tier(page)).tier, "(mock Stripe keeps status active; period end", (await tier(page)).current_period_end, ")");
  await page.request.delete(`/e2e-mock/stripe/v1/subscriptions/${subId}`);
  const canceled = (await (await page.request.get(`/e2e-mock/stripe/v1/subscriptions/${subId}`)).json());
  log("D2 period ends: Stripe status", canceled.status, "→ subscription.deleted:", await send(page, evt("customer.subscription.deleted", canceled)), "tier", (await tier(page)).tier, "status", (await tier(page)).status);
  // E. Payment Link path: client_reference_id
  const email2 = `audit4-link-${Date.now()}@example.com`;
  const u2 = await signIn(browser, email2);
  const uid = (await exp(u2.page)).account.id;
  const body = `${uid}_${Date.now() + 7 * 86400000}`;
  const mac = createHmac("sha256", createHash("sha256").update(`me:cref:${SECRET}`).digest()).update(body).digest("hex");
  const mk = async (ref) => {
    const f = new URLSearchParams({ client_reference_id: ref, customer: `cus_link${randomUUID().slice(0, 6)}`, "line_items[0][price]": "price_pro_y", success_url: `${base}/account?checkout=success` });
    const cs = await (await u2.page.request.post("/e2e-mock/stripe/v1/checkout/sessions", { data: f.toString(), headers: { "content-type": "application/x-www-form-urlencoded" } })).json();
    const r = await u2.page.request.get(`/e2e-mock/stripe/pay/${cs.id}`, { maxRedirects: 0 });
    return `${r.status()} ${r.status() >= 400 ? await r.text() : ""}`;
  };
  log("E1 Payment Link checkout with RAW user id as client_reference_id (unsigned):", await mk(uid), "tier", (await tier(u2.page)).tier);
  log("E2 Payment Link checkout with signed client_reference_id:", await mk(`${body}_${mac}`), "tier", (await tier(u2.page)).tier);
  // F. delete account cancels the subscription
  const sub2 = (await exp(u2.page)).subscription;
  const del = await u2.page.request.delete("/api/account", { data: { email: email2 }, headers: { origin: base, "content-type": "application/json" } });
  const after = await (await u2.page.request.get(`/e2e-mock/stripe/v1/subscriptions/${sub2.stripe_subscription_id}`)).json();
  log("F1 DELETE /api/account:", del.status(), await del.text(), "→ Stripe sub", sub2.stripe_subscription_id, "status", after.status, "canceled_at", after.canceled_at, "; /api/me user", JSON.stringify((await tier(u2.page)).user));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
