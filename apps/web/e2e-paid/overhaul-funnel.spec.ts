// T-299 (docs/OVERHAUL.md §F3): walk the whole funnel once, repeating every step that could double-fire (reloads, second
// clicks, a second paid invoice), and assert each step is recorded exactly once. The sink is the funnel_events table
// in the in-app Supabase mock (read with the mock's service key); the server sends PostHog exactly the rows it inserts
// (lib/funnel-server.ts, unit-tested), and no PostHog key is set here, so nothing leaves the machine.
import { expect, test, type Page } from "@playwright/test";
import Stripe from "stripe";

const SERVICE = "e2e-service";       // playwright.paid.config.ts SUPABASE_SERVICE_ROLE_KEY
const WEBHOOK_SECRET = "whsec_e2e";  // playwright.paid.config.ts STRIPE_WEBHOOK_SECRET
type Row = { user_id: string | null; event: string };

const table = async (page: Page, name: string) =>
  (await (await page.request.get(`/e2e-mock/supabase/rest/v1/${name}?select=*`, { headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE } })).json()) as Record<string, unknown>[];
const funnelRows = async (page: Page) => (await table(page, "funnel_events")) as Row[];
const anonCounts = async (page: Page) => {
  const c: Record<string, number> = {};
  for (const r of await funnelRows(page)) if (!r.user_id) c[r.event] = (c[r.event] ?? 0) + 1;
  return c;
};
/** Navigate and wait for the page's funnel POST to be answered. */
async function visit(page: Page, path: string, step: string) {
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/funnel") && r.request().postData()?.includes(`"${step}"`) === true, { timeout: 60_000 });
  await page.goto(path);
  return (await (await answered).json()) as { counted: boolean };
}
async function webhook(page: Page, id: string, type: string, object: object) {
  const payload = JSON.stringify({ id, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await page.request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": header, "content-type": "application/json" } });
  expect(res.status(), `${type} webhook`).toBe(200);
}

test("funnel: every step fires exactly once per user (signed-out steps once per visit)", async ({ page, context }) => {
  test.setTimeout(300_000);
  await context.route(/polymarket\.com|kalshi\.com/, (r) => r.abort());   // the venue button opens the venue: never leave
  const email = `funnel-${Date.now()}@example.com`;
  const before = await anonCounts(page);

  // Signed out: landing → plans → sign-up page.
  expect((await visit(page, "/", "landing_view")).counted).toBe(true);
  expect((await visit(page, "/pricing", "upgrade_view")).counted).toBe(true);
  expect((await visit(page, "/signup?next=/bets", "signup_start")).counted).toBe(true);

  // Sign up with a password, confirm from the mock inbox → signup_done on the first sign-in.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator("input").and(page.getByLabel("Password", { exact: true })).fill("funnel password 1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  await page.goto(url);
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/bets$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  const me = (await (await page.request.get("/api/me")).json()) as { user: { id: string; email: string } };
  expect(me.user.email).toBe(email);
  const uid = me.user.id;
  const mine = async () => (await funnelRows(page)).filter((r) => r.user_id === uid).map((r) => r.event).sort();

  // First Best bets view: the redirect to /bets after sign-up counted it; opening the page again never does.
  await expect.poll(mine, { timeout: 30_000 }).toContain("first_bets_view");
  expect((await visit(page, "/bets", "first_bets_view")).counted).toBe(false);
  expect((await visit(page, "/bets", "first_bets_view")).counted).toBe(false);
  // Signed in, `/` is not a landing view and /signup isn't a sign-up start.
  expect((await visit(page, "/", "landing_view")).counted).toBe(false);

  // First "Bet on Polymarket" click: twice, across two page loads.
  for (let i = 0; i < 2; i++) {
    await page.goto("/bets");
    const button = page.getByTestId("venue-button").first();
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/funnel") && r.request().postData()?.includes("first_bet_click") === true, { timeout: 60_000 });
    if (await button.count()) {
      await button.click();
    } else {
      // The card button (components/trade/VenueButton.tsx) is placed by lane B; until that merges no page renders it.
      test.info().annotations.push({ type: "pending", description: "no venue-button on /bets yet (lane B); sent the click step the button sends" });
      await page.evaluate(() => fetch("/api/funnel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "first_bet_click" }) }));
    }
    expect((await (await answered).json()).counted).toBe(i === 0);
  }

  // Plans page signed in (twice), then checkout: mock Stripe pays and sends the signed webhooks → trial_start.
  expect((await visit(page, "/pricing", "upgrade_view")).counted).toBe(true);
  expect((await visit(page, "/pricing", "upgrade_view")).counted).toBe(false);
  await page.getByTestId("checkout-pro").click();
  await expect(page).toHaveURL(/\/account\?checkout=success/, { timeout: 45_000 });

  // Paid: the first invoice with money, sent twice (and a renewal) by Stripe → one "paid".
  const sub = (await table(page, "subscriptions")).find((r) => r.user_id === uid)!;
  expect(sub.status).toBe("trialing");
  const customer = String(sub.stripe_customer_id);
  await webhook(page, `evt_trial_invoice_${uid}`, "invoice.paid", { id: "in_0", object: "invoice", customer, amount_paid: 0, currency: "usd" });
  await webhook(page, `evt_first_charge_${uid}`, "invoice.paid", { id: "in_1", object: "invoice", customer, amount_paid: 900, currency: "usd" });
  await webhook(page, `evt_first_charge_${uid}`, "invoice.paid", { id: "in_1", object: "invoice", customer, amount_paid: 900, currency: "usd" });   // Stripe retry
  await webhook(page, `evt_renewal_${uid}`, "invoice.paid", { id: "in_2", object: "invoice", customer, amount_paid: 900, currency: "usd" });

  // Exactly once each, for this user…
  expect(await mine()).toEqual(["checkout_start", "first_bet_click", "first_bets_view", "paid", "signup_done", "trial_start", "upgrade_view"].sort());
  // …and exactly one signed-out row per signed-out step this test made.
  const after = await anonCounts(page);
  for (const step of ["landing_view", "upgrade_view", "signup_start"]) expect((after[step] ?? 0) - (before[step] ?? 0), step).toBe(1);
  for (const step of ["signup_done", "first_bets_view", "first_bet_click", "checkout_start", "trial_start", "paid"]) expect(after[step] ?? 0, `anon ${step}`).toBe(0);

  // Server-only steps can't be forged from the browser.
  const forged = await page.evaluate(async () => (await fetch("/api/funnel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "paid" }) })).status);
  expect(forged).toBe(400);
});

test("admin /admin/funnel shows daily counts and step-to-step conversion", async ({ page }) => {
  test.setTimeout(180_000);
  // ADMIN_EMAILS in playwright.paid.config.ts; the mock creates the account on the first magic link.
  const email = "admin-e2e@example.com";
  await page.goto("/login?next=/admin/funnel");
  await expect(async () => {
    await page.getByRole("tab", { name: "Email link" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  await page.goto(url);
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin\/funnel$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByTestId("admin-funnel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("funnel-total-paid")).not.toHaveText("0");          // the walk above paid
  await expect(page.getByTestId("funnel-step-signup_done")).toContainText("Signed up");
  await expect(page.getByTestId("funnel-step-signup_start")).toContainText("%");
  await page.screenshot({ path: "test-results/admin-funnel.png", fullPage: true });
});
