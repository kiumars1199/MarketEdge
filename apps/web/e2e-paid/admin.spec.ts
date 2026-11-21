// Admin dashboard (T-141/T-142): an ADMIN_EMAILS address sees /admin and flips the site-wide banner; a normal
// user and an anonymous visitor get a 404 on every admin page and API route. Supabase/Stripe are the in-app mock.
import { expect, test, type Page } from "@playwright/test";

const ADMIN = "admin-e2e@example.com";   // playwright.paid.config.ts ADMIN_EMAILS
const PAGES = ["/admin", "/admin/users", "/admin/settings", "/admin/health", "/admin/audit", "/admin/users/00000000-0000-0000-0000-000000000000"];

async function signIn(page: Page, email: string) {
  await page.goto("/login?next=/account");
  await expect(async () => {   // T-275: the password tab is the default; retry until the page has hydrated
    await page.getByRole("tab", { name: "Email link" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  await page.goto(url);
  await expect(page).toHaveURL(/\/onboarding\?next=%2Faccount/);   // first sign-in: onboarding, then `next` (as s7-upgrade)
  // Skip is enabled once hydrated. Re-click only while still on /onboarding: a click that started as the page left
  // would wait forever for a button /account doesn't have (AUDIT run 3 fail 2: a slow /account compile under load).
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

// Combos and Kalshi (live since Nov 21, owner decision; KALSHI_DATA_PERMISSION=true in playwright.paid.config.ts).
// Signed out: the account wall. A signed-in Free customer: the Kalshi page and its nav link (no Beta pill); no Combos
// link, /combos shows the Premium upgrade, the combos API answers none and the Kalshi combo check is off (Premium only).
async function expectLaunched(page: Page, signedOut = false) {
  if (signedOut) {   // T-276: signed out, these pages are behind the account wall like every app page, and their APIs are 401
    for (const p of ["/combos", "/kalshi"]) {
      await page.goto(p);
      await expect(page).toHaveURL(new RegExp(`/signup\\?next=%2F${p.slice(1)}$`));
    }
    for (const p of ["/api/combos?pays=2", "/api/kalshi", "/api/combos/kalshi"]) expect((await page.request.get(p)).status(), p).toBe(401);
    await page.goto("/pricing");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Combos|Kalshi/ })).toHaveCount(0);
    expect((await (await page.request.get("/api/me")).json()).beta).toBeFalsy();
    return;
  }
  expect((await page.goto("/kalshi"))?.status(), "/kalshi").toBe(200);
  await expect(page.getByRole("heading", { name: "Kalshi markets", level: 1 })).toBeVisible();
  await expect(page.getByTestId("beta-banner")).toHaveCount(0);
  expect((await page.goto("/combos"))?.status(), "/combos").toBe(200);
  await expect(page.getByTestId("combos-upgrade")).toBeVisible();
  const nav = page.locator("header").getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /^Kalshi/ })).toBeVisible({ timeout: 15_000 });   // once /api/me answers
  await expect(nav.getByRole("link", { name: /^Kalshi/ }).getByTestId("beta-badge")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: /^Combos/ })).toHaveCount(0);
  expect((await (await page.request.get("/api/combos?pays=2")).json()).groups).toEqual([]);
  expect((await page.request.get("/api/kalshi")).status()).toBe(200);
  expect((await (await page.request.get("/api/combos/kalshi")).json()).enabled).toBe(false);
  const me = await (await page.request.get("/api/me")).json();
  expect(me.beta).toBeFalsy();
  expect(me.nav).toEqual(["kalshi"]);   // Lane C's server-decided nav (lib/beta.ts navFeatures)
}

/** Wait for the write itself (60 s, cold compiles under load), then the status line: not a fixed 5 s. */
async function saveSettings(page: Page) {
  const write = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/admin", { timeout: 60_000 });
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await write).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
}

async function expectNoAdmin(page: Page) {
  for (const p of PAGES) expect((await page.goto(p))?.status(), p).toBe(404);
  const origin = new URL(page.url()).origin;
  const post = await page.request.post("/api/admin", { data: { action: "settings", patch: { banner_on: true } }, headers: { origin } });
  expect(post.status(), "POST /api/admin").toBe(404);
  expect((await page.request.get("/api/admin/export")).status(), "GET /api/admin/export").toBe(404);
  expect((await page.request.get("/api/me")).ok()).toBe(true);
  expect((await (await page.request.get("/api/me")).json()).admin).toBeFalsy();
}

test("admin: sees /admin with a user count, flips the banner and everyone sees it", async ({ page, browser }) => {
  await signIn(page, ADMIN);
  await expect(page.getByRole("link", { name: "Admin panel" })).toBeVisible();

  // Premium plan: Combos and Kalshi in the nav and on their pages, no Beta marker anywhere (live since Nov 21)
  expect(await (await page.request.get("/api/me")).json()).toMatchObject({ beta: true, tier: "premium", nav: ["combos", "kalshi"] });
  const nav = page.locator("header").getByRole("navigation", { name: "Main" });
  for (const [label, path] of [["Combos", "/combos"], ["Kalshi", "/kalshi"]] as const) {
    const link = nav.getByRole("link", { name: new RegExp(`^${label}`) });
    await expect(link).toBeVisible({ timeout: 15_000 });   // these links appear once /api/me answers after each page load
    await expect(link.getByTestId("beta-badge")).toHaveCount(0);
    expect((await page.goto(path))?.status(), path).toBe(200);
    await expect(page.getByTestId("beta-banner")).toHaveCount(0);
  }
  await expect(page.getByTestId("combos-upgrade")).toHaveCount(0);
  expect((await page.request.get("/api/kalshi")).status()).toBe(200);
  expect((await (await page.request.get("/api/combos/kalshi")).json()).enabled).toBe(true);

  // T-276 activation: a signed-in Best bets render stamps the first visit (after the response, so poll /admin)
  await page.goto("/");
  await expect(page.locator("[data-row]").first()).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-first-bets-7d")).toHaveText(/^[1-9][\d,]*$/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await expect(page.getByTestId("admin-users-total")).toHaveText(/^[1-9][\d,]*$/);
  // T-276 activation: this admin's sign-up is counted (the mock serves admin_activation like the migration)
  await expect(page.getByTestId("admin-signups-7d")).toHaveText(/^[1-9][\d,]*$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByText("Market analytics, not financial advice. Based on past results. 18+.")).toBeVisible();

  const text = `Scheduled upgrade ${Date.now()}`;
  await page.goto("/admin/settings");
  await page.getByRole("switch", { name: "Show announcement banner" }).click();
  await page.getByLabel("Banner text").fill(text);
  await saveSettings(page);

  await page.goto("/pricing");
  await expect(page.getByTestId("site-banner")).toHaveText(text);
  const anon = await browser.newContext();
  const other = await anon.newPage();
  await other.goto("/");
  await expect(other.getByTestId("site-banner")).toHaveText(text);
  await anon.close();

  await page.goto("/admin/audit");
  await expect(page.getByTestId("audit-log")).toContainText("settings.update");

  // turn it off again so other specs see the default site
  await page.goto("/admin/settings");
  await page.getByRole("switch", { name: "Show announcement banner" }).click();
  await saveSettings(page);
  await page.goto("/pricing");
  await expect(page.getByTestId("site-banner")).toHaveCount(0);
});

test("normal user and anonymous visitor: 404 on every admin page and API route, no Admin link; Kalshi yes, Combos Premium only", async ({ page, browser }) => {
  await signIn(page, `user-${Date.now()}@example.com`);
  await expect(page.getByRole("link", { name: "Admin panel" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await expectNoAdmin(page);
  await expectLaunched(page);

  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await anon.goto("/");
  await expectNoAdmin(anon);
  await expectLaunched(anon, true);
  await ctx.close();
});
