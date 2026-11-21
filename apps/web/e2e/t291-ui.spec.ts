// T-291 (outside tester, production): "Show more" appends and keeps the scroll position. T-302 (R2-6) replaces the
// T-291 #11 loading rule: a filter change keeps the current list on screen, dimmed and marked busy, until the new
// list arrives (no skeleton flash), and the old rows are never clickable meanwhile.
import { expect, test } from "@playwright/test";

test("Best bets: Show more appends cards and keeps the scroll position", async ({ page }) => {
  // every bet ungrouped, 25 a page, international included: enough pages for Show more on the fixture
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/api\/flags\?.*pg=2/, async (route) => { await gate; await route.continue(); });   // hold page 2
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?us=0&g=0&ps=25");
  const list = page.getByTestId("bets-list");
  const cards = list.locator("[data-row]");
  await expect(cards).toHaveCount(25);
  const firstId = await cards.first().getAttribute("data-market-id");

  const more = list.getByRole("button", { name: /^Show more/ });
  await more.scrollIntoViewIfNeeded();
  const y0 = await page.evaluate(() => window.scrollY);
  expect(y0).toBeGreaterThan(500);
  await more.click();

  await expect(list.getByRole("button", { name: "Loading…" })).toBeVisible();
  await expect(cards).toHaveCount(25);
  release();

  await expect.poll(() => cards.count()).toBeGreaterThan(25);
  await expect(cards.first()).toHaveAttribute("data-market-id", firstId!);
  const y1 = await page.evaluate(() => window.scrollY);
  expect(Math.abs(y1 - y0)).toBeLessThan(200);
});

test("Best bets: a filter change keeps the current list, dimmed and busy, until the new one arrives", async ({ page }) => {
  await page.goto("/");
  const list = page.getByTestId("bets-list");
  await expect(list.locator("[data-row]").first()).toBeVisible();
  const oldIds = await list.locator("[data-row]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.marketId));

  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/api\/flags\?.*us=0/, async (route) => { await gate; await route.continue(); });
  await page.getByTestId("us-chip").click();
  await expect(page).toHaveURL(/us=0/);

  // still the old list, marked busy, no skeleton
  await expect(list).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("list", { name: "Loading best bets" })).toHaveCount(0);
  expect(await list.locator("[data-row]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.marketId))).toEqual(oldIds);
  await expect(list).toHaveCSS("pointer-events", "none");
  release();

  await expect(list).toHaveAttribute("aria-busy", "false");
  await expect(list.locator("[data-venue=intl-only]").first()).toBeVisible();
});
