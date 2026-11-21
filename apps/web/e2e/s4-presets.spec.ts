// S4 (docs/12): save preset "NFL edges" → switch away → apply it → identical rows; share link opens it in a new context.
// Needs C1's /markets: <PresetBar>/<QuickChips> mounted, result rows with data-row + data-market-id.
import { expect, test, type Page } from "@playwright/test";

const rowIds = (page: Page) => page.locator("[data-row]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.marketId));

test("S4 presets: save, switch, re-apply, share", async ({ page, browser, baseURL }) => {
  await page.goto("/markets?t=sports.nfl&e=0.02");
  await page.locator("[data-row]").first().waitFor();
  const before = await rowIds(page);
  expect(before.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "+ Save this view" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("NFL edges");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: /^NFL edges/, pressed: true })).toBeVisible();

  await page.getByRole("button", { name: "Best bets right now" }).click();
  await expect(page).not.toHaveURL(/t=sports\.nfl/);

  await page.getByRole("button", { name: /^NFL edges/ }).click();
  await expect(page).toHaveURL(/t=sports\.nfl/);
  await expect(page).toHaveURL(/e=0\.02/);
  await expect.poll(() => rowIds(page)).toEqual(before);

  // survives reload
  await page.reload();
  await expect(page.getByRole("button", { name: /^NFL edges/, pressed: true })).toBeVisible();

  // share link → new context (no presets) → offered "Save to my presets", same rows
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await page.getByRole("button", { name: "More actions for NFL edges" }).click();
  await page.getByRole("menuitem", { name: "Copy share link" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("preset=NFL+edges");

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(link);
  await p2.getByRole("dialog").getByRole("button", { name: "Save to my presets" }).click();
  await expect(p2.getByRole("button", { name: /^NFL edges/, pressed: true })).toBeVisible();
  await expect.poll(() => rowIds(p2)).toEqual(before);
  await other.close();
});
