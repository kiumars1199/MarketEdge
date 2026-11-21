// S5 (docs/12): star 2 markets → /watchlist shows them with "since saved"; unstar one.
import { expect, test } from "@playwright/test";

// Needs C1's /markets rows with a <WatchStar> each (accessible name "Save" / "Saved").
test("S5 star two markets from the screener", async ({ page }) => {
  await page.goto("/markets");
  await page.locator("[data-row]").first().waitFor();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.first().click();
  await save.first().click(); // the first one is now "Saved", so this stars the next market
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveCount(2);

  await page.goto("/watchlist");
  await expect(page.locator("[data-row]")).toHaveCount(2);
  await expect(page.getByText(/since saved/i)).toHaveCount(2);

  await page.getByRole("button", { name: "Saved", exact: true }).first().click();
  await expect(page.locator("[data-row]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("[data-row]")).toHaveCount(1);
});

// Runs without C1: seeds two saved markets (fixture ids) the way WatchStar stores them.
test("S5 My list shows saved markets with since-saved and unstars", async ({ page }) => {
  const snap = (ask: number, roi: number) => ({ ask, win_prob: 0.9, edge: 0.05, roi_pct: roi, question: "q", outcome: null, closes_at: 1795137300, saved_side: 0 });
  await page.addInitScript((rows) => {
    if (!localStorage.getItem("me:v1:watchlist")) localStorage.setItem("me:v1:watchlist", JSON.stringify(rows));
  }, [
    { id: "w1", market_id: "6417673", side_index: null, note: null, target_price: null, snapshot: snap(0.5, 40), created_at: "2026-11-16T10:00:00.000Z" },
    { id: "w2", market_id: "6841043", side_index: null, note: null, target_price: null, snapshot: snap(0.5, 40), created_at: "2026-11-16T11:00:00.000Z" },
  ]);
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "My list" })).toBeVisible();
  await expect(page.locator("[data-row]")).toHaveCount(2);
  await expect(page.getByText(/^Since saved: price 50→/)).toHaveCount(2);
  await expect(page.getByText("Colts vs. Texans")).toBeVisible();

  await page.getByRole("button", { name: "Saved", exact: true }).first().click();
  await expect(page.locator("[data-row]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("[data-row]")).toHaveCount(1);
});
