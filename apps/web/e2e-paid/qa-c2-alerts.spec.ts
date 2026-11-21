// Marc's QA list, Nov 20 (lane C2): #23 /alerts never renders blank on first load; #23/#64 the page says plainly
// where alerts go, a Pro rule can turn email on (the server cron emails it), and /pricing no longer sells
// Telegram/Discord alerts. Supabase and Stripe are the in-app mock (app/e2e-mock).
import { expect, test, type Page } from "@playwright/test";

async function signUpPro(page: Page, email: string) {
  await page.goto("/login?next=/pricing");
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
    await expect(page).toHaveURL(/\/pricing$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await page.getByTestId("checkout-pro").click();
  await expect(page).toHaveURL(/\/account\?checkout=success/, { timeout: 45_000 });
  await expect(page.getByTestId("checkout-status")).toHaveText("Payment confirmed. Your plan is active.", { timeout: 30_000 });
}

test("#23/#64 Pro: /alerts renders before its scripts load, says where alerts go, and a new rule can email", async ({ page }) => {
  await signUpPro(page, `qa-c2-alerts-${Date.now()}@example.com`);

  // #23: what shows before any client chunk loads (chunks aborted; inline scripts still run). Server-rendered header
  // and a loading line, never an empty page. (Not reproduced blank in the mock before the change either; see the log.)
  await page.goto("/alerts");   // compile once on the dev server
  await page.route("**/_next/static/chunks/**", (r) => r.abort());
  await page.goto("/alerts");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expect(main.getByText(/While Kismet is open in a tab, rules check every 2 minutes/)).toBeVisible();
  await expect(main.getByText("Loading your alerts…")).toBeVisible();   // not "No alert rules yet" before data loads
  await page.unroute("**/_next/static/chunks/**");

  await page.goto("/alerts");
  await expect(page.getByText(/While Kismet is open in a tab, rules check every 2 minutes/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/our servers also check once a day, even when Kismet is closed/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "No alert rules yet" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "New alert" }).click();
  const dialog = page.getByRole("dialog");
  const emailSwitch = dialog.getByRole("switch", { name: "Email" });
  await expect(emailSwitch).toBeChecked();   // Pro: a new rule starts with email on
  await expect(dialog.getByText("Checked once a day, even when Kismet is closed")).toBeVisible();
  await dialog.getByRole("button", { name: "Create alert" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/inbox \+ email/)).toBeVisible();
  const { alert_rules } = await (await page.request.get("/api/data")).json();
  expect(alert_rules).toHaveLength(1);
  expect(alert_rules[0].channels).toEqual(["email"]);
});

test("#64 /pricing sells no Telegram or Discord alerts and says email is checked once a day", async ({ request }) => {
  const html = await (await request.get("/pricing")).text();
  expect(html).not.toMatch(/Telegram|Discord/);
  expect(html).toContain("Email (checked once a day) + browser while Kismet is open, 20 rules");
  expect(html).toContain("Alerts by email (checked once a day) and in the browser while Kismet is open, 20 rules");
});

test("#38/#58/#72 /pricing states the AI connector allowance the same way on the table and the cards", async ({ request }) => {
  const html = await (await request.get("/pricing")).text();
  expect(html).toContain("Use Kismet in Claude, ChatGPT and Cursor: 3 calls a day");
  expect(html).toContain("Use Kismet in Claude, ChatGPT and Cursor: no daily cap (up to 60 calls a minute)");
  expect(html).toContain(">3 calls a day<");
  expect(html).toContain(">No daily cap (up to 60 calls a minute)<");
  expect(html).not.toContain("read-only connector)");
});
