// Marc's QA list, Nov 20 (lane C): #32 "Start trial" keeps plan and period through sign-up and lands in checkout;
// #18/#48 /account shows the plan, the trial-end date and "Manage billing or cancel" (Stripe portal), and Terms and
// Refunds point there. Supabase and Stripe are the in-app mock (app/e2e-mock).
import { expect, test } from "@playwright/test";

test("#32 → #18: Start trial (Premium, yearly) signed out → sign-up → checkout → /account shows plan, trial end, cancel", async ({ page }) => {
  const email = `qa-c-trial-${Date.now()}@example.com`;
  await page.goto("/pricing");
  await expect(async () => {   // hydrated toggle: pick Yearly, the link follows
    await page.getByRole("radio", { name: /Yearly/ }).click();
    await expect(page.getByTestId("start-trial-premium")).toHaveAttribute("href", "/signup?next=%2Fpricing%3Fstart%3Dpremium_yearly", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByTestId("start-trial-premium").click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fpricing%3Fstart%3Dpremium_yearly$/, { timeout: 60_000 });

  await expect(async () => {
    await page.getByRole("tab", { name: "Email link" }).click();
    await expect(page.getByRole("button", { name: /Email me a sign-in link|Email me a sign-up link/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Email me a sign-in link|Email me a sign-up link/ }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  await page.goto(url);
  // first sign-in: onboarding, still carrying the plan and period
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fpricing%3Fstart%3Dpremium_yearly/);
  // Skip setup → /pricing?start=premium_yearly opens Premium yearly checkout by itself → mock Stripe → /account
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/account\?checkout=success/, { timeout: 20_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByTestId("checkout-status")).toHaveText("Payment confirmed. Your plan is active.", { timeout: 60_000 });

  await page.goto("/account");
  await expect(page.getByTestId("plan-name")).toHaveText("Premium");
  await expect(page.getByText("Free trial", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Trial ends [A-Z][a-z]+ \d{1,2}, \d{4}$/)).toBeVisible();
  await expect(page.getByTestId("manage-billing")).toHaveText("Manage billing or cancel");
  await expect(page.getByTestId("billing-note")).toContainText("cancel");
  // the button opens the Stripe portal (the mock answers with /account as the portal URL)
  const portal = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/stripe/portal");
  await page.getByTestId("manage-billing").click();
  expect((await portal).status()).toBe(200);
});

test("#48: Terms and Refunds send cancellation to /account's Manage billing or cancel", async ({ request }) => {
  for (const path of ["/terms", "/refunds"]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain('href="/account"');
    expect(html, path).toContain("Manage billing or cancel");
  }
});
