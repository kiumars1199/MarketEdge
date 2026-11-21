// Marc's QA list #17/#73 (Nov 20): signed in, the header is the same on every page, /kalshi and the 404 page included,
// and it doesn't wait for /api/me (no links popping in). Supabase/Stripe are the in-app mock.
import { expect, test, type Page } from "@playwright/test";

const ADMIN = "admin-e2e@example.com";   // playwright.paid.config.ts ADMIN_EMAILS (beta tester: sees Combos, Kalshi)

async function signIn(page: Page, email: string) {
  await page.goto("/login?next=/account");
  await expect(async () => {
    await page.getByRole("tab", { name: "Email link" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  await page.goto(url);
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

/** The server-rendered header (first HTML, before any script runs). */
async function firstHeader(page: Page, path: string): Promise<string> {
  const html = await (await page.request.get(path)).text();
  const m = html.match(/<header[\s\S]*?<\/header>/);
  expect(m, `${path}: header in the first HTML`).toBeTruthy();
  return m![0];
}

const has = (h: string, href: string) => h.includes(`href="${href}"`);

/** The header with /api/me never answering: what the layout's hint alone renders. The 404 page streams its whole body
 *  (header included) from the RSC payload, in production too (kismetodds.com/nope-xyz), so it is checked this way. */
async function headerWithoutMe(page: Page, path: string, want: string[], not: RegExp | null) {
  await page.route("**/api/me", (r) => r.abort());
  await page.goto(path);
  const header = page.locator("header").first();
  for (const name of want) await expect(header.getByRole("link", { name: new RegExp(`^${name}`) }).first(), `${path} ${name}`).toBeVisible();
  if (not) await expect(header.getByRole("link", { name: not }), path).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Sign in" }), path).toHaveCount(0);
  await page.unroute("**/api/me");
}

test("#17/#73 admin: Combos, Kalshi, Admin, Account on every page without waiting for /api/me", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, ADMIN);
  for (const p of ["/bets", "/kalshi", "/pricing"]) {
    const h = await firstHeader(page, p);
    for (const href of ["/combos", "/kalshi", "/admin", "/account"]) expect(has(h, href), `${p} ${href}`).toBe(true);
    expect(h, p).not.toMatch(/>Sign in</);
  }
  for (const p of ["/nope-xyz", "/kalshi"]) await headerWithoutMe(page, p, ["Combos", "Kalshi", "Admin", "Account"], null);
  // after hydration it stays the same (no link removed or added once /api/me answers)
  await page.goto("/kalshi");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /Kalshi/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /Combos/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Account" }).first()).toBeVisible();
});

test("#17/#73 normal user: Account everywhere, no Admin, Kalshi (live for every plan), no Combos (Premium)", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, `qa-c-hdr-${Date.now()}@example.com`);
  for (const p of ["/bets", "/pricing"]) {
    const h = await firstHeader(page, p);
    expect(has(h, "/account"), p).toBe(true);
    for (const href of ["/admin", "/combos"]) expect(has(h, href), `${p} ${href}`).toBe(false);
    expect(has(h, "/kalshi"), `${p} /kalshi`).toBe(true);   // QA-D: Kalshi is live for every signed-in plan
  }
  await headerWithoutMe(page, "/nope-xyz", ["Account", "Kalshi"], /^(Admin|Combos)/);
});
