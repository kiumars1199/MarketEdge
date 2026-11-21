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
  // Marc #28 (Nov 20): the top 3 are the real Best bets card, sorted by the return each card shows (a band's low end on
  // Free), with the same payout line and the same $10 stake inside "Why this bet?"
  const cards = page.locator("article[data-testid=bet-card]");
  await expect(cards.first()).toBeVisible();
  const rets = (await cards.getByTestId("card-return").allTextContents()).map((t) => Number(/[+−-]?[\d.]+/.exec(t)![0].replace("−", "-")));
  expect(rets.length).toBeGreaterThan(0);
  expect([...rets].sort((x, y) => y - x)).toEqual(rets);
  for (const t of await cards.getByTestId("card-money").allTextContents()) expect(t).toMatch(/^Pays [\d.]+x/);
  await cards.first().getByText("Why this bet?").click();
  await expect(cards.first().getByTestId("why-back").locator("p")).toHaveText(/^If it wins you get \$[\d,.]+ back \(\$10 \+ \$[\d,.]+\)$/);
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
  await expect(page.getByText("$99.99 billed yearly")).toBeVisible();
  await expect(page.getByTestId("save-pro")).toContainText("save 30%");   // T-291 #15: per plan, from the prices
  await expect(page.getByTestId("save-premium")).toContainText("save 29%");
  await expect(page.getByTestId("price-premium")).toHaveText("$14.17");   // $169.99 / 12
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
