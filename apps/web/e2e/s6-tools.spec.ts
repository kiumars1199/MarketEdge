// S6: Kelly sizing at the defaults (win chance 60%, price 50¢, no fee) gives full Kelly 20%.
import { expect, test } from "@playwright/test";

test("S6 Kelly calculator: q=0.6, p=0.5 gives 20%", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("tab", { name: "Kelly sizing" }).click();
  await expect(page.getByLabel("Win chance (%)")).toHaveValue("60");
  await expect(page.getByTestId("full-kelly")).toHaveText("20%");
});
