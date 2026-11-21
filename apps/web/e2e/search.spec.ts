// docs/13 examples as flows: type → suggestions within 300 ms → search → results match. Plus the simple pills.
import { expect, test, type Page } from "@playwright/test";

type Row = { market: { question: string; event: string; niche: string; category: string }; side: { win_prob: number; outcome: string } };
const text = (r: Row) => `${r.market.question} ${r.market.event} ${r.side.outcome}`;

test.beforeAll(async ({ request }) => {
  // dev server compiles routes on first hit; warm them so the 300 ms budget measures the search, not webpack
  for (const q of ["warm", "bar"]) await request.get(`/api/suggest?q=${q}`);
  await request.get("/api/markets?q=warm");
});

async function type(page: Page, q: string) {
  await page.waitForLoadState("networkidle");   // hydrated: typing before React attaches is lost
  const box = page.getByRole("combobox", { name: "Search markets" });
  await box.click();
  await box.fill(q.slice(0, -1));
  const t = Date.now();
  await box.press(q.at(-1)!);
  return { box, t };
}

/** Search on /markets and return the rows the server sent for it. */
async function search(page: Page, q: string): Promise<{ rows: Row[]; search?: { relaxed?: string } }> {
  await page.goto("/markets");
  await page.locator("[data-row]").first().waitFor();
  const { box } = await type(page, q);
  const res = page.waitForResponse((r) => r.url().includes("/api/markets?") && new URL(r.url()).searchParams.get("q") === q);
  await box.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(q);   // ?q= in the URL
  return (await res).json();
}

test("bar → FC Barcelona suggested on the 3rd letter, within 300 ms", async ({ page }) => {
  await page.goto("/markets");
  // one untimed round trip first, so a dev server busy compiling other specs isn't what gets measured
  await type(page, "fc");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("combobox", { name: "Search markets" }).fill("");
  const { t } = await type(page, "bar");
  await expect(page.getByRole("option", { name: /FC Barcelona/ }).first()).toBeVisible({ timeout: 300 });
  expect(Date.now() - t).toBeLessThan(300);
  // typo still finds it
  const box = page.getByRole("combobox", { name: "Search markets" });
  await box.fill("barcelna");
  await expect(page.getByRole("option", { name: /FC Barcelona/ }).first()).toBeVisible();
});

test("barca 3x → the line says how it's understood", async ({ page }) => {
  await page.goto("/");
  await type(page, "barca 3x");
  await expect(page.getByTestId("search-line")).toHaveText("Searching Barcelona · Pays ~3x");
});

test("barcelona 3x good edge → honest fallback, Barcelona rows", async ({ page }) => {
  const r = await search(page, "barcelona 3x good edge");
  expect(r.rows.length).toBeGreaterThan(0);
  expect(r.rows.every((x) => /barcelona/i.test(text(x)))).toBe(true);
  await expect(page.getByTestId("relaxed")).toContainText("No bets match all of Barcelona · Pays ~3x · Return 10%+ right now.");
  await expect(page.getByRole("button", { name: "Remove from search: Barcelona" })).toBeVisible();
});

test("nyc weather → New York weather, shown as chips", async ({ page }) => {
  const r = await search(page, "nyc weather");
  expect(r.rows.length).toBeGreaterThan(0);
  expect(r.rows.every((x) => x.market.category === "weather" && /new york|nyc/i.test(text(x)))).toBe(true);
  const chips = page.getByRole("list", { name: "Search understood as" });
  await expect(chips.getByRole("button")).toHaveText(["City: New York", "Weather & Climate", "Clear search"]);
  // removing a chip edits the query
  await chips.getByRole("button", { name: "Remove from search: Weather & Climate" }).click();
  await expect(page).toHaveURL(/q=nyc(&|$)/);
});

test("over 2.5 goals → soccer over/under 2.5", async ({ page }) => {
  const r = await search(page, "over 2.5 goals");
  expect(r.rows.length).toBeGreaterThan(0);
  expect(r.rows.every((x) => x.market.niche === "soccer" && /2\.5/.test(x.market.question))).toBe(true);
});

test("safe bets → every row 80%+", async ({ page }) => {
  const r = await search(page, "safe bets");
  expect(r.rows.length).toBeGreaterThan(0);
  expect(r.rows.every((x) => x.side.win_prob >= 0.8)).toBe(true);
});

// T-302: Best bets has its own one-row chips (e2e/overhaul-cards.spec.ts); the dropdown pills are on All markets.
test("pills: Pays 3–5x and Biggest payout land in the URL; long shots toggle", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("button", { name: "Pays", exact: true }).click();
  await page.getByRole("dialog", { name: "Pays" }).getByRole("button", { name: /^3–5x/ }).click();
  await expect(page).toHaveURL(/x0=3&x1=5|x1=5&x0=3/);
  await expect(page.getByRole("button", { name: /^Pays: 3–5x/ })).toBeVisible();
  await page.getByRole("button", { name: /^Sort/ }).click();
  await page.getByRole("dialog", { name: "Sort" }).getByRole("button", { name: "Biggest payout" }).click();
  await expect(page).toHaveURL(/s=pays\.desc/);

  // phone: the pill opens as a sheet; tapping the dimmed area closes it without changing filters
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Chance/ }).click();
  await expect(page.getByRole("dialog", { name: "Chance" })).toBeVisible();
  await page.mouse.click(195, 60);
  await expect(page.getByRole("dialog", { name: "Chance" })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("/markets");
  await page.getByRole("button", { name: /Hiding long shots/ }).click();
  await expect(page).toHaveURL(/wp=0(&|$)/);
});
