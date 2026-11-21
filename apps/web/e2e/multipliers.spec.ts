// docs/18 (Lane C): the long-shot fixture (id 9900010: Yes at 10¢, wins 14%, +4 pts, tier "edge"), the 10x+ chip,
// and the combo leg rules (Marc #15, #42, #65, #74).
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// The fixtures are one old scan (DATA_CLOCK=scan on the server). The combo tray checks legs against the browser's
// clock (closed or past-dated legs can't be added), so these tests set the browser to the scan's time.
const SCAN_S: number = JSON.parse(readFileSync("test/fixtures/flags.json", "utf8")).meta.scanned_at;
const atScan = (page: Page) => page.clock.setFixedTime(SCAN_S * 1000);

// T-302: Best bets no longer has "Big payouts" / "More bets with an edge" rows or Pays chips (one chip row, docs/OVERHAUL.md
// §B). The long shot is lower confidence and not on Polymarket US, so it shows only with a payout filter (which widens
// to both tiers, tierOf) and international bets included; its record sits inside "Why this bet?".
test("long shot: a 10x+ payout filter with international bets brings it in, with its losing band record", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main [data-tier=edge]").filter({ hasText: "Harbor City" })).toHaveCount(0);
  await page.goto("/?x0=10&us=0");
  const card = page.locator("article[data-tier=edge]").filter({ hasText: "Harbor City" }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-venue", "intl-only");
  await expect(card.getByTestId("card-chance")).toHaveText("14% chance to win");
  await card.getByText("Why this bet?").click();
  await expect(card.getByText(/^Lower:/)).toBeVisible();
  await expect(card.getByTestId("band-record")).toContainText("lost money in testing");
});

test("drawer: long-shot line under 25% chance", async ({ page }) => {
  await page.goto("/?m=9900010");
  const drawer = page.getByRole("dialog", { name: "Market details" });
  await expect(drawer.getByTestId("long-shot-line")).toContainText("Most of the time this loses.");
});

test("combo #15: a second leg from the same event (by event id) is refused", async ({ page }) => {
  await atScan(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("me-combo-v1"));
  // two markets of event 1313371 ("Denmark vs. Norway - More Markets"), different questions
  await page.goto("/?m=6674492");
  let drawer = page.getByRole("dialog", { name: "Market details" });
  const add = drawer.getByRole("button", { name: "Add to combo" });
  await expect(add.getByTestId("beta-badge")).toHaveCount(0);   // live since Nov 21: no Beta tag
  await add.click();
  await expect(drawer.getByRole("button", { name: "In combo ✓" })).toBeVisible();
  await page.goto("/?m=6674493");
  drawer = page.getByRole("dialog", { name: "Market details" });
  await drawer.getByRole("button", { name: "Add to combo" }).click();
  await expect(drawer.getByRole("alert")).toContainText("already has a bet from this event");
  await expect(drawer.getByRole("button", { name: "Add to combo" })).toBeVisible();

  const tray = page.getByTestId("combo-tray");
  await expect(tray).toBeVisible();
  await expect(tray.getByTestId("beta-badge")).toHaveCount(0);
  await expect(tray.getByText("Your combo · 1 leg")).toBeVisible();
  await expect(tray.getByTestId("same-event")).toHaveCount(0);

  // Persisted locally: survives a reload; Clear empties it.
  await page.goto("/");
  await expect(page.getByTestId("combo-tray")).toBeVisible();
  await page.getByRole("button", { name: "Expand combo" }).click();
  await page.getByRole("button", { name: "Clear combo" }).click();
  await expect(page.getByTestId("combo-tray")).toHaveCount(0);
});

// docs/19 P5: the Combos page browses by payout; every card pays at least the chosen floor.
// T-302: the Combos row left Best bets (one list for casual bettors); Combos keeps its own page (live, no Beta tag).
test("combos page: payout tabs, each card pays at least the floor, Build this combo opens the tray", async ({ page }) => {
  await page.goto("/combos");
  await page.evaluate(() => localStorage.removeItem("me-combo-v1"));
  await expect(page.getByRole("heading", { level: 1, name: "Combos" })).toBeVisible();
  // live since Nov 21 (owner decision): no Beta banner on the page, no pill on the nav link
  await expect(page.getByTestId("beta-banner")).toHaveCount(0);
  const navLink = page.locator("header").getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Combos/ });
  await expect(navLink).toBeVisible({ timeout: 15_000 });
  await expect(navLink.getByText("Beta")).toHaveCount(0);   // neither the pill nor the small-screen dot (qa-c-header)
  for (const p of [2, 3, 5, 10]) {
    await page.getByRole("button", { name: `Pays ${p}x+` }).click();
    await expect(page).toHaveURL(new RegExp(`pays=${p}$`));
    await expect(page.getByRole("button", { name: `Pays ${p}x+` })).toHaveAttribute("aria-pressed", "true");
    const cards = page.getByTestId("combo-card");
    await expect(cards.first().or(page.getByTestId("combos-empty"))).toBeVisible();
    for (const v of await cards.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-pays"))))) expect(v).toBeGreaterThanOrEqual(p);
  }
  await page.getByRole("button", { name: "Pays 2x+" }).click();
  await expect(page.getByTestId("combo-card").first()).toBeVisible();
  // #65: the intro names the leg counts and payouts of the combos on screen
  const shown = await page.getByTestId("combo-card").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-pays"))));
  const x = (p: number) => `${p >= 10 ? Math.round(p) : p.toFixed(1)}x`;
  await expect(page.getByTestId("combos-range")).toContainText(x(Math.min(...shown)));
  await expect(page.getByTestId("combos-range")).toContainText(x(Math.max(...shown)));
  // #74: every number on a leg is labelled; the return sits at the chance beside it
  const card = page.getByTestId("combo-card").first();
  for (const l of await card.getByTestId("combo-leg").all()) await expect(l).toContainText(/· Pays [\d.]+x after fee · \d+% chance to win \(cautious\)/);
  await expect(card).toContainText(/Estimated return [+−][\d.]+% at a \d+% chance to win/);

  await card.getByRole("button", { name: /Build this combo/ }).click();
  const tray = page.getByTestId("combo-tray");
  await expect(tray).toBeVisible();
  // the tray's return and chance are the card's (one chance: the cautious one)
  const chance = (await tray.getByTestId("combo-chance").innerText()).match(/^\d+%/)![0];
  await expect(tray.getByText(`Estimated return at ${chance}`)).toBeVisible();
});

test("combo #42: a saved leg that has closed leaves the tray, with a note", async ({ page }) => {
  await atScan(page);
  await page.goto("/");
  await page.evaluate((closed) => localStorage.setItem("me-combo-v1", JSON.stringify({ state: { legs: [{
    market_id: "x1", side_index: 0, question: "Old game", outcome: "Yes", event_id: "ex", event: "Old game",
    url: "https://polymarket.com/event/x", ask: 0.5, fee: 0.01, q: 0.6, q_low: 0.55, closes_at: closed,
  }] }, version: 0 })), SCAN_S - 3600);
  await page.reload();
  await expect(page.getByTestId("combo-dropped")).toContainText("its bets have closed");
  await expect(page.getByTestId("combo-tray")).toHaveCount(0);
});
