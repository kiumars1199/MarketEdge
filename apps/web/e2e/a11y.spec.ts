// Lane U (docs/17): axe over every page, plus the drawer. Zero serious or critical violations (WCAG 2.1 A/AA).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const STATIC = [
  "/", "/markets", "/about", "/pricing", "/login", "/signup", "/onboarding", "/account", "/watchlist", "/journal", "/alerts",
  "/dashboards", "/settings", "/tools", "/track-record", "/status", "/terms", "/privacy", "/refunds", "/disclaimer",
  "/contact", "/ext/connect", "/combos", "/no-such-page",
];

async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

// `live`: the page polls the order book every 5 s (MarketDetail useLiveBook), so the network never goes idle; wait
// instead until the market and its book have rendered (loaded or failed), with nothing still busy.
async function check(page: Page, path: string, live = false) {
  await page.goto(path);
  if (live) {
    await page.waitForLoadState("load");
    const detail = path.includes("?m=") ? page.getByRole("dialog") : page.locator("main");
    await expect(detail.getByTestId("one-bet").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Loading the live order book…")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  } else await page.waitForLoadState("networkidle");
  // the page's own footer disclaimer is on every page (CLAUDE.md rule 5)
  await expect(page.getByRole("contentinfo")).toContainText("Market analytics, not financial advice. Based on past results. 18+.");
  expect(await serious(page), path).toEqual([]);
}

test.describe.configure({ mode: "parallel" });

for (const path of STATIC) test(`axe ${path}`, async ({ page }) => check(page, path));

test("axe /event, /m and the open drawer", async ({ page, request }) => {
  const { rows } = await (await request.get("/api/flags?ps=1")).json();
  const m = rows[0].market;
  await check(page, `/event/${m.event_id}`);
  await check(page, `/m/${m.id}`, true);
  await check(page, `/?m=${m.id}&side=${rows[0].side.side_index}`, true);
  await expect(page.getByRole("dialog")).toBeVisible();
});

// Audit fails 3–4: the open drawer keeps Tab and Shift+Tab inside it (the page behind is inert), and Escape
// gives focus back to the card that opened it.
test("keyboard: the drawer traps focus and Escape returns it to the opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.locator('main a[href*="m="]').first();
  await opener.waitFor();
  await page.waitForLoadState("networkidle");
  const href = await opener.getAttribute("href");
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Market details" });
  await expect(dialog.getByRole("button", { name: /^Save/ })).toBeVisible();
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press(key);
      expect(await inDialog(), `${key} #${i + 1} left the drawer`).toBe(true);
    }
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("href"))).toBe(href);
});

test("keyboard: Pricing is a visible footer link, not inside a hidden dialog", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("contentinfo").getByRole("link", { name: "Pricing" });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pricing$/);
});
