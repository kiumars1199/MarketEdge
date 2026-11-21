// Alerts demo: a loose "new market in a view" rule fires once; a second check does not duplicate it.
import { expect, test } from "@playwright/test";

const rule = {
  id: "e2e-rule", name: "All markets", enabled: true, kind: "preset_match",
  query: { _view: "builtin:all", _view_name: "All markets" }, market_id: null, side_index: null, threshold: 1,
  channels: [], webhook_url: null, cooldown_minutes: 60, quiet_hours: null,
  created_at: "2026-11-16T00:00:00Z", last_fired_at: null,
};

test("Run now fires one alert, running again keeps one", async ({ page }) => {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("me:v1:alert_rules", JSON.stringify([r]));
      sessionStorage.setItem("seeded", "1");
    }
  }, rule);
  await page.goto("/alerts?tab=inbox");
  const items = page.getByTestId("inbox").locator("li");
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(items).toHaveCount(1);
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByRole("status")).toHaveText("No new alerts.");
  await expect(items).toHaveCount(1);
});
