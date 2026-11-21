// S2 (docs/12): filter NFL + spreads + edge ≥ 2¢ → URL updates → reload keeps the view → reset clears it.
import { expect, test } from "@playwright/test";

test("S2 filters live in the URL", async ({ page }) => {
  await page.goto("/markets");
  const panel = page.getByRole("dialog", { name: "Filters" });
  const open = () => page.getByRole("button", { name: /^More filters/ }).click();   // docs/13 §2: full panel is a sheet
  await page.locator("[data-row]").first().waitFor();
  await open();

  await panel.getByRole("searchbox", { name: "Find a topic" }).fill("NFL");
  await panel.getByRole("checkbox", { name: /^NFL\b/ }).click(); // URL-controlled: state flips after navigation
  await expect(page).toHaveURL(/t=sports\.nfl/);
  await panel.getByRole("checkbox", { name: /^spreads\b/ }).click();
  await expect(page).toHaveURL(/mt=spreads/);
  await panel.getByLabel("Min price gap", { exact: true }).fill("2");
  const filtered = page.waitForResponse((r) => r.url().includes("/api/markets?") && r.url().includes("e=0.02"));
  await panel.getByLabel("Min price gap", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/e=0\.02/);
  await filtered;

  const rows = page.locator("[data-row]");
  await expect(rows.first()).toBeVisible();
  const ids = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.marketId));

  await page.reload();
  await expect(page).toHaveURL(/t=sports\.nfl/);
  await expect(page).toHaveURL(/e=0\.02/);
  await open();
  await expect(panel.getByRole("checkbox", { name: /^NFL\b/ })).toBeChecked();
  await expect(panel.getByLabel("Min price gap", { exact: true })).toHaveValue("2");
  await expect.poll(() => rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.marketId))).toEqual(ids);

  await panel.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page).toHaveURL(/\/markets$/);
  await expect(panel.getByRole("checkbox", { name: /^spreads\b/ })).not.toBeChecked();
});
