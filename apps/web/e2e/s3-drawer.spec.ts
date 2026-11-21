// S3 (docs/12): open a flag → drawer shows price check, stake table, curve; custom stake $250 recomputes.
// The live order book (/api/book → Polymarket) is mocked so the run is offline and deterministic.
import { expect, test } from "@playwright/test";

const row = (stake: number) => ({ stake_usd: stake, filled_usd: stake, shares: stake / 0.68, avg_price: 0.68, edge: 0.2, expected_profit_usd: stake * 0.3, roi_pct: 30 });
const book = (stake?: number) => ({
  book_ok: true, best_bid: 0.67, best_ask: 0.68, book_mid: 0.675, spread: 0.01, spread_cost: 0.005, fee_at_ask: 0.01,
  gross_edge: 0.22, net_edge: 0.2, retention: 0.9, capacity_usd: 5000, limit_price: 0.67, limit_edge: 0.21, verdict: "worth it",
  stakes: [25, 100, 500, 1000, ...(stake ? [stake] : [])].sort((a, b) => a - b).map(row),
  fetched_at: Date.now(),
});

test("S3 drawer: price check, stake table, curve, custom stake", async ({ page }) => {
  await page.route("**/api/book*", (r) => {
    const stake = Number(new URL(r.request().url()).searchParams.get("stake")) || undefined;
    return r.fulfill({ json: book(stake) });
  });
  await page.goto("/");
  await page.locator("[data-row] h3 a").first().click();

  const drawer = page.getByRole("dialog", { name: "Market details" });
  await expect(page).toHaveURL(/[?&]m=/);
  await expect(drawer.getByText("Price check ✓ fair fill")).toBeVisible();
  const stakes = drawer.getByRole("table");
  await expect(stakes.getByRole("columnheader", { name: "You bet" })).toBeVisible();
  await expect(stakes.locator("tbody tr")).toHaveCount(4);
  await expect(drawer.getByRole("img", { name: /^Chart:/ })).toBeVisible();

  await drawer.getByLabel("Your own stake").fill("250");
  await drawer.getByRole("button", { name: "Check", exact: true }).click();
  await expect(stakes.locator("tbody tr")).toHaveCount(5);
  await expect(stakes.locator("tbody tr", { hasText: "$250" })).toContainText("+$75");
});

// T-289 / T-302: one return figure per bet. The card face is plain-language (docs/OVERHAUL.md §B); its "Why this bet?"
// carries the same return the drawer headlines (an international card: a US card shows the US price's return).
test("card's 'Why this bet?' and the drawer show the same return and win chance", async ({ page }) => {
  await page.route("**/api/book*", (r) => r.fulfill({ json: book() }));
  await page.goto("/?us=0");
  const card = page.locator("article[data-row][data-venue=intl-only]").first();
  await card.getByText("Why this bet?").click();
  const ret = (await card.getByTestId("why-return").innerText()).trim();
  expect(ret).toMatch(/^[+−-]?\d/);
  const back = (await card.getByTestId("why-back").locator("p").innerText()).trim();
  expect(back).toMatch(/^If it wins you get \$[\d,.]+ back \(\$[\d,]+ \+ \$[\d,.]+\)$/);
  const chance = (await card.getByTestId("card-chance").innerText()).trim();
  expect(chance).toMatch(/^(\d+% chance to win|Under 1% chance to win|Over 99% chance to win)$/);
  await card.locator("h3 a").click();
  const drawer = page.getByRole("dialog", { name: "Market details" });
  await expect(drawer.getByTestId("bet-return")).toHaveText(ret);
});
