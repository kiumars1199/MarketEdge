// S7 (docs/12): sign up → upgrade (Stripe mocked) → gated feature unlocks. Plus account delete.
// Supabase and Stripe are the in-app mock (app/e2e-mock); the magic link is read from its inbox.
import { expect, test, type Page } from "@playwright/test";
import type { MarketsResponse } from "@/lib/api";

async function signIn(page: Page, email: string) {
  await page.goto("/login?next=/pricing");
  await expect(async () => {   // T-275: the password tab is the default; retry until the page has hydrated
    await page.getByRole("tab", { name: "Email link" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await expect(page.locator("input[type=checkbox]:invalid")).toHaveCount(1);   // 18+/Terms is required
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });   // first call compiles the route
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  expect(url).toContain("/auth/callback");
  await page.goto(url);
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fpricing/);   // first sign-in: onboarding, then the page sign-in started from
  // On a cold dev server the click can land before hydration; retry until the navigation starts.
  // Re-click only while still on /onboarding: a click that started as the page left would wait for a missing button.
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/pricing$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  // Skipping is saved to the account, not just this browser (the next sign-in goes straight to `next`).
  const { profile } = await (await page.request.get("/api/data")).json();
  expect(profile.onboarded_at).toBeTruthy();
}

const rows = async (page: Page) => (await (await page.request.get("/api/markets?ps=200")).json()) as MarketsResponse;

test("S7 sign up → upgrade with Stripe → Pro unlocks live data and exact numbers", async ({ page }) => {
  const email = `s7-${Date.now()}@example.com`;
  await signIn(page, email);

  const free = await rows(page);
  expect(free.rows).toHaveLength(10);
  expect(free.rows[0].side.ranges).toBeDefined();
  expect((await (await page.request.get("/api/me")).json()).tier).toBe("free");
  // T-288: Free is exactly 10 Best bets a day, and says so (never "Free shows 89 …")
  await page.goto("/bets");
  await expect(page.getByTestId("locked-bets")).toContainText("Free shows 10 Best bets a day");

  // §B (T-302): Free Best bets end in one solid inline card, "Unlock N more bets" → /pricing. It covers nothing, so it
  // has no close button (the T-291 #11 overlay it replaced did).
  await page.goto("/");
  const panel = page.getByTestId("locked-bets");
  await panel.scrollIntoViewIfNeeded();
  const unlock = panel.getByRole("link", { name: /^Unlock [\d,]+ more bets?$/ });
  await expect(unlock).toBeVisible();
  await expect(unlock).toHaveAttribute("href", "/pricing");
  await expect(page.getByTestId("locked-close")).toHaveCount(0);

  await page.goto("/pricing");
  await page.getByTestId("checkout-pro").click();
  await expect(page).toHaveURL(/\/account\?checkout=success/, { timeout: 45_000 });   // checkout → mock Stripe → signed webhooks
  await expect(page.getByTestId("checkout-status")).toHaveText("Payment confirmed. Your plan is active.", { timeout: 30_000 });   // the page polls /api/me every 2 s for up to 60 s
  await expect(page.getByText("Pro", { exact: true }).first()).toBeVisible();

  const pro = await rows(page);
  expect(pro.rows.length).toBeGreaterThan(25);
  expect(pro.rows.every((r) => r.side.ranges === undefined)).toBe(true);
  // T-288: a paid page never shows the Free allowance, not even before /api/me answers (first-paint HTML and after)
  for (const path of ["/", "/bets"]) {
    expect(await (await page.request.get(path)).text(), path).not.toContain("locked-bets");
    await page.goto(path);
    await expect(page.getByTestId("bet-card").nth(10)).toBeVisible();   // more than Free's 10 rendered (§B card)
    await expect(page.getByTestId("locked-bets")).toHaveCount(0);
  }
  await page.goto("/pricing");
  await expect(page.getByTestId("checkout-pro")).toHaveCount(0);   // "Your plan" instead of a second checkout

  // Deleting a paying account cancels the Stripe subscription first (a failed cancel blocks the delete).
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete account…" }).click();
  await page.getByLabel(`Type ${email} to confirm`).fill(email);
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page).toHaveURL(/\/\?deleted=1/, { timeout: 30_000 });
  expect((await (await page.request.get("/api/me")).json()).user).toBeNull();
});

test("account delete: type the email, everything goes, signed out", async ({ page }) => {
  const email = `del-${Date.now()}@example.com`;
  await signIn(page, email);
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete account…" }).click();
  const confirm = page.getByRole("button", { name: "Delete permanently" });
  await page.getByLabel(`Type ${email} to confirm`).fill("someone-else@example.com");
  await expect(confirm).toBeDisabled();
  await page.getByLabel(`Type ${email} to confirm`).fill(email);
  await confirm.click();
  await expect(page).toHaveURL(/\/\?deleted=1/, { timeout: 30_000 });   // same budget as the paid delete above
  const me = await (await page.request.get("/api/me")).json();
  expect(me.user).toBeNull();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/signup\?next=%2Faccount/);   // T-276: signed out, app pages go to sign-up
});

// Audit fail 5: a Free user reaches the upgrade with the keyboard alone: search → drawer → save → "See plans".
test("keyboard only: search → drawer → save → upgrade reaches /pricing", async ({ page }) => {
  await signIn(page, `kbd-${Date.now()}@example.com`);
  // Best bets (/) shows Free only the day's sample, so search for a bet in it (/api/flags is that sample).
  const sample = (await (await page.request.get("/api/flags?ps=200")).json()) as MarketsResponse;
  const q = sample.rows[0]!.market.question;
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const tabTo = async (target: ReturnType<Page["locator"]>, max = 80) => {
    for (let i = 0; i < max && !(await target.evaluate((el) => el === document.activeElement).catch(() => false)); i++) await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
  };

  const box = page.getByRole("combobox", { name: "Search markets" });
  await tabTo(box);
  await page.keyboard.type(q);
  await page.keyboard.press("Enter");   // search → results
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(q);
  const card = page.locator('main a[href*="m="]').first();
  // T-291 #11: the results replace a loading state (the old list no longer stays up meanwhile), and on next dev the
  // first search request compiles the route, so wait for the real results rather than 5 s.
  await expect(card).toBeVisible({ timeout: 30_000 });
  await tabTo(card);
  await page.keyboard.press("Enter");   // card → drawer

  const dialog = page.getByRole("dialog", { name: "Market details" });
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeVisible({ timeout: 30_000 });
  await tabTo(save);
  // Wait for the write itself, not a fixed 5 s: on next dev the drawer's first /api/book compile holds the server,
  // and the POST queues behind it (seconds, more on a busy machine). The star flips only once the row is stored.
  const write = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/data/watchlist", { timeout: 60_000 });
  await page.keyboard.press("Enter");
  expect((await write).status()).toBe(200);
  await expect(dialog.getByRole("button", { name: "Saved", exact: true })).toBeVisible();

  const plans = dialog.getByRole("link", { name: "See plans" });
  await tabTo(plans);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pricing$/);
});
