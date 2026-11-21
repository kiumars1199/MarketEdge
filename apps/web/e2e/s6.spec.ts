// S6 (first half): /track-record tiles equal fixture backtest.json. Plus landing, pricing and status smoke checks.
// The /tools Kelly half of S6 belongs to Lane D2.
import { expect, test } from "@playwright/test";
import fixture from "../test/fixtures/backtest.json";
import { edge, formatCount, ret } from "../lib/format";

const r = fixture.results[String(fixture.chosen_half_life_days ?? "None") as keyof typeof fixture.results].taker;
const int = formatCount;   // docs/18 §4: counts short, rounded down (exact on hover)

test("S6: Results tiles equal backtest.json", async ({ page }) => {
  await page.goto("/track-record");
  const tile = (k: string) => page.getByTestId(`tile-${k}`).getByTestId("tile-value");
  await expect(tile("bets")).toHaveText(int(r.flags));
  await expect(tile("ret")).toHaveText(ret(r.roi_pct));
  await expect(tile("cents")).toHaveText(edge(r.pnl_cents_per_share / 100));
  await expect(tile("t")).toHaveText(r.t_stat.toFixed(1));
  await expect(tile("events")).toHaveText(int(r.events));
  await expect(page.getByRole("heading", { name: "Limitations" })).toBeVisible();
  await expect(page.getByText("Market analytics, not financial advice.")).toBeVisible();
});

test("landing (/about): headline, counters, preview cards, Open screener", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Same payout. Different odds.");
  await expect(page.getByText("past bets tested")).toBeVisible();
  await expect(page.getByTestId("preview-card").first()).toBeVisible();
  // T-291 #13: top 3 sorted by the return each card shows, priced at the Best bets default stake ($100)
  const rets = (await page.getByTestId("preview-card").getByTestId("return").allTextContents()).map((t) => Number(t.replace(/[^0-9.+-]/g, "")));
  expect(rets.length).toBeGreaterThan(0);
  expect([...rets].sort((x, y) => y - x)).toEqual(rets);
  for (const t of await page.getByTestId("preview-card").getByTestId("payout").allTextContents()) expect(t).toMatch(/^Bet \$100 →/);
  await expect(page.getByTestId("freshness")).toBeVisible();
  await page.getByRole("link", { name: "Open screener", exact: true }).click();
  await expect(page).toHaveURL(/\/markets/);
});

test("pricing: yearly toggle shows the yearly price", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByTestId("price-pro")).toHaveText("$11.99");
  await expect(page.getByRole("columnheader", { name: "Pro · $11.99" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Premium · $19.99" })).toBeVisible();
  await page.getByRole("radio", { name: /Yearly/ }).click();
  await expect(page.getByText("$119.99 billed yearly")).toBeVisible();
  await expect(page.getByTestId("save-pro")).toContainText("save 16%");   // T-291 #15: per plan, from the prices
  await expect(page.getByTestId("save-premium")).toContainText("save 16%");
  await expect(page.getByTestId("price-premium")).toHaveText("$16.67");   // $199.99 / 12
  await expect(page.getByText("Demo: every feature is unlocked", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start trial" }).first()).toHaveAttribute("href", "/");
});

test("status page lists scan, fit and backtest times", async ({ page }) => {
  await page.goto("/status");
  for (const name of ["Last market scan", "Last model fit", "Last backtest"]) await expect(page.getByText(name)).toBeVisible();
  // T-291 #16: the data source names the product engine, never the config instance ("engine instance demo")
  await expect(page.getByText("Kismet engine", { exact: false })).toBeVisible();
  await expect(page.getByText(/engine instance|instance demo/)).toHaveCount(0);
});
