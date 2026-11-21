// S1 (docs/12, updated by T-70 / docs/13): land on / → Best bets cards → "All markets" → /markets shows rows and a
// freshness pill. The old landing lives at /about ("How it works" in header and footer).
import { expect, test } from "@playwright/test";

test("S1 / is Best bets → All markets rows + freshness pill", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("where the odds lean your way");
  await expect(page.locator("[data-row]").first()).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "All markets" }).first().click();
  await expect(page).toHaveURL(/\/markets$/);
  await expect(page.locator("[data-row]").first()).toBeVisible();
  await expect(page.getByTestId("freshness")).toBeVisible();
  await expect(page.getByText(/markets? match/)).toBeVisible();
});

test("S1 old landing at /about, linked from the footer; /flags redirects to /", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("contentinfo").getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Same payout. Different odds.");
  await page.goto("/flags?t=weather");
  await expect(page).toHaveURL(/\/\?t=weather$/);
});

// docs/19 P1: demo mode has no signed-out state, so / stays Best bets (above); /bets (the landing CTA) is the same page.
test("S1 /bets is Best bets too", async ({ page }) => {
  await page.goto("/bets");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("where the odds lean your way");
  await expect(page.locator("[data-row]").first()).toBeVisible();
});
