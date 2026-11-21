// Marc's QA list #9 (Nov 20): on Free, the "More filters" sheet is mostly the Pro upgrade pitch. It closes with a ✕, with
// Escape and with a click outside it. A filter change on All markets says it is loading. Supabase/Stripe: the in-app mock.
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
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
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

test("#9 Free: the filter sheet with the Pro pitch closes with ✕, Escape and a click outside; /markets shows loading", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, `qa-c-up-${Date.now()}@example.com`);
  for (const path of ["/bets", "/markets"]) {
    await page.goto(path);
    const sheet = page.getByRole("dialog", { name: "Filters" });
    const open = async () => {
      await expect(async () => {
        await page.getByRole("button", { name: /^More filters/ }).first().click();
        await expect(sheet).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
      await expect(sheet.getByRole("link", { name: "Upgrade to unlock" })).toBeAttached();   // Free: the Pro pitch
    };
    await open();
    await sheet.getByRole("button", { name: "Close filters" }).click();
    await expect(sheet, `${path} ✕`).toBeHidden();
    await open();
    await page.keyboard.press("Escape");
    await expect(sheet, `${path} Escape`).toBeHidden();
    await open();
    await page.mouse.click(100, 450);   // the backdrop, left of the right-hand sheet
    await expect(sheet, `${path} backdrop`).toBeHidden();
  }
  // /markets: while a filter change loads, a visible status says so (Best bets has "Updating bets…")
  await page.route((u) => u.pathname === "/api/markets", async (r) => { await new Promise((f) => setTimeout(f, 2_500)); await r.continue(); });
  await page.getByRole("group", { name: "Quick filters" }).getByRole("button", { name: "Confident" }).click();
  await expect(page.getByTestId("markets-updating")).toHaveText("Loading markets…");
  await expect(page.getByTestId("markets-updating")).toBeHidden({ timeout: 30_000 });
});
