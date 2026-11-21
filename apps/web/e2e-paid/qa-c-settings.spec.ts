// Marc's QA list #21/#22 (Nov 20): /settings is one tap from /account (and back); settings are saved to the account, so a
// second device sees them; the "Choose your topics" banner never flashes for someone who finished or dismissed setup,
// and dismissing it is saved to the account. Supabase/Stripe: the in-app mock.
import { expect, test, type Browser, type Page } from "@playwright/test";

/** Magic-link sign-in. `onboard`: skip setup on /onboarding (first sign-in); false: leave it unfinished. */
async function signIn(page: Page, email: string, onboard = true) {
  await page.goto("/login?next=/account");
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
  if (!onboard) { await page.waitForURL(/\/(onboarding|account)/, { timeout: 60_000 }); return; }
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

async function secondDevice(browser: Browser, email: string, onboard = true) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, onboard);
  return { ctx, page };
}

test("#21/#22 settings: linked from /account, saved to the account, seen on a second device", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const email = `qa-c-set-${Date.now()}@example.com`;
  await signIn(page, email);
  await page.getByTestId("account-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText("Saved to your account, so they follow you to any device.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan and billing" })).toHaveAttribute("href", "/account");
  await expect(page.getByRole("button", { name: "Clear local data" })).toHaveCount(0);   // would delete nothing in the account
  const numbers = page.getByRole("radiogroup", { name: "Show numbers as" });
  const write = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/data/profile", { timeout: 60_000 });
  await expect(async () => {
    await numbers.getByRole("radio", { name: /^Pro/ }).click();
    await expect(numbers.getByRole("radio", { name: /^Pro/ })).toHaveAttribute("aria-checked", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  expect((await write).status()).toBe(200);
  await page.goto("/journal");
  await expect(page.getByText(/Saved to your account\./)).toBeVisible();

  const other = await secondDevice(browser, email);
  await other.page.goto("/settings");
  await expect(other.page.getByRole("radiogroup", { name: "Show numbers as" }).getByRole("radio", { name: /^Pro/ })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await other.ctx.close();
});

test("#22 onboarding banner: never flashes once setup is done; dismissing is saved to the account", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const banner = (p: Page) => p.getByRole("complementary", { name: "Get started" });

  // finished (skipped) setup: the banner never shows, not even before the account's profile has loaded
  await signIn(page, `qa-c-nudge-done-${Date.now()}@example.com`);
  expect(await (await page.request.get("/bets")).text()).not.toContain('aria-label="Get started"');   // not in the first HTML
  await page.route((u) => u.pathname === "/api/data", async (r) => { await new Promise((f) => setTimeout(f, 2_000)); await r.continue(); });
  await page.goto("/bets");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 6; i++) { await expect(banner(page)).toHaveCount(0); await page.waitForTimeout(500); }
  await page.unroute((u) => u.pathname === "/api/data");

  // setup not finished: the banner shows; dismissing it is saved, so a second device doesn't show it
  const email = `qa-c-nudge-${Date.now()}@example.com`;
  const first = await secondDevice(browser, email, false);
  await first.page.goto("/bets");
  await expect(banner(first.page)).toBeVisible({ timeout: 60_000 });
  const write = first.page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/data/profile", { timeout: 60_000 });
  await banner(first.page).getByRole("button", { name: "Dismiss" }).click();
  expect((await write).status()).toBe(200);
  await expect(banner(first.page)).toHaveCount(0);
  await first.ctx.close();

  const again = await secondDevice(browser, email, false);
  await again.page.goto("/bets");
  await expect(again.page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  await again.page.waitForTimeout(3_000);
  await expect(banner(again.page)).toHaveCount(0);
  await again.ctx.close();
});
