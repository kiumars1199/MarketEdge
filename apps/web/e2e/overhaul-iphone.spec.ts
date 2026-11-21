// docs/OVERHAUL.md §D: every app page on iPhone sizes (WebKit, 390×844 and 430×932; projects in playwright.config.ts).
// Signed-out pages (landing, signup, login) only exist with DEMO_MODE=false: e2e-paid/overhaul-iphone.spec.ts.
import { expect, test } from "@playwright/test";
import { checkPage } from "./iphone/iphone";

const PAGES = ["/", "/bets", "/markets", "/combos", "/watchlist", "/journal", "/alerts", "/settings", "/account", "/tools",
  "/dashboards", "/kalshi", "/onboarding", "/pricing", "/about", "/track-record", "/status", "/contact", "/terms", "/privacy",
  "/disclaimer", "/refunds", "/maintenance", "/no-such-page"];

for (const url of PAGES) test(`iPhone ${url}`, async ({ page }, info) => {
  await checkPage(page, url, info, url === "/no-such-page" ? { status: 404 } : {});   // the not-found page must say 404
});

test("iPhone event and market pages", async ({ page }, info) => {
  await page.goto("/bets");
  const id = await page.locator("[data-market-id]").first().getAttribute("data-market-id");
  expect(id).toBeTruthy();
  await checkPage(page, `/m/${encodeURIComponent(id!)}`, info);
});

test("iPhone drawer: fits the screen, closes, keeps focus usable", async ({ page }) => {
  await page.goto("/bets");
  const card = page.locator("[data-row], [data-testid=bet-card]").first();
  await card.locator("a").first().click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  const close = dialog.getByRole("button", { name: /close/i }).first();
  await expect(close).toBeInViewport();
  await close.click();
  await expect(dialog).toBeHidden();
});

test("iPhone search input stays visible when focused", async ({ page }) => {
  await page.goto("/markets");
  const input = page.getByRole("searchbox").or(page.getByRole("combobox")).or(page.getByPlaceholder(/search/i)).first();
  await input.focus();
  await page.keyboard.type("weather");
  await expect(input).toBeInViewport();
});
