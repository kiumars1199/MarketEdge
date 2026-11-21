// T-275: email + password. Sign up → confirm from the inbox → signed in; the session survives a new browser context
// (the sb-* cookie lasts weeks, it isn't a session cookie) and sign-out clears it; sign in with the password;
// forgot → reset link → /reset-password → new password works, the old one doesn't. Supabase is the in-app mock.
import { expect, test, type Page } from "@playwright/test";

const PASS = "first password 1";
const NEW_PASS = "second password 2";
const RESET_SENT = /If that email has an account, we sent a reset link/;

const me = async (page: Page) => (await (await page.request.get("/api/me")).json()) as { user: { email: string } | null };
const inbox = async (page: Page, email: string) =>
  ((await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json()) as { url: string | null }).url;

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");   // the form submits with fetch once hydrated
  await expect(page.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true");   // the default tab
}
async function fill(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator("input").and(page.getByLabel("Password", { exact: true })).fill(password);   // not the tab panel, also named "Password"
  await page.getByRole("checkbox").check();
}
async function logIn(page: Page, email: string, password: string, next = "/account") {
  await open(page, `/login?next=${encodeURIComponent(next)}`);
  await fill(page, email, password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}
async function signOut(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(async () => (await me(page)).user).toBeNull();
}

test("password: sign up, confirm by email, stay signed in, sign out, sign in again", async ({ page, browser, context }) => {
  test.setTimeout(240_000);
  const email = `pw-${Date.now()}@example.com`;

  await open(page, "/signup?next=/pricing");
  await fill(page, email, PASS);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  expect((await me(page)).user).toBeNull();   // no session until the address is confirmed

  // An unconfirmed account can't sign in with the password yet.
  await logIn(page, email, PASS);
  await expect(page.getByText("Confirm your email first")).toBeVisible();

  const link = await inbox(page, email);
  expect(link).toContain("/auth/callback");
  await page.goto(link!);
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fpricing/);   // new account: onboarding, then where sign-up started
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/pricing$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  expect((await me(page)).user?.email).toBe(email);

  // Persistent session: the auth cookie expires weeks out, and a fresh browser context with the saved state is signed in.
  const auth = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(auth.length).toBeGreaterThan(0);
  for (const c of auth) {
    expect(c.httpOnly).toBe(true);
    expect(c.expires * 1000, `${c.name} is a persistent cookie`).toBeGreaterThan(Date.now() + 14 * 86_400_000);
  }
  const state = await context.storageState();
  const again = await browser.newContext({ storageState: state, baseURL: new URL(page.url()).origin });
  expect((await (await again.request.get("/api/me")).json()).user?.email).toBe(email);
  await again.close();

  await signOut(page);
  expect((await context.cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);

  // Wrong password: the generic answer. Right one: back in, straight to `next` (already onboarded).
  await logIn(page, email, "not the password");
  await expect(page.getByText("Wrong email or password.", { exact: true })).toBeVisible();
  await logIn(page, email, PASS);
  await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
  expect((await me(page)).user?.email).toBe(email);
});

test("password: forgot → reset link → set a new one → sign in with it", async ({ page }) => {
  test.setTimeout(240_000);
  const email = `reset-${Date.now()}@example.com`;
  await open(page, "/signup");
  await fill(page, email, PASS);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  await page.goto((await inbox(page, email))!);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.request.get("/api/me");
  await signOut(page);

  // Without a reset link the page explains and points back to "Forgot password?".
  await page.goto("/reset-password");
  await expect(page.getByRole("link", { name: /Forgot password/ })).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);

  // The same answer for an address with no account.
  await open(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(`nobody-${Date.now()}@example.com`);
  await Promise.all([page.waitForResponse("**/api/auth/reset"), page.getByRole("button", { name: "Forgot password?" }).click()]);
  await expect(page.getByRole("status")).toContainText(RESET_SENT);

  await page.getByLabel("Email", { exact: true }).fill(email);
  await Promise.all([page.waitForResponse("**/api/auth/reset"), page.getByRole("button", { name: "Forgot password?" }).click()]);
  await expect(page.getByRole("status")).toContainText(RESET_SENT);
  const link = await inbox(page, email);
  expect(link).toContain("next=%2Freset-password");
  await page.goto(link!);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("New password").fill(NEW_PASS);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible({ timeout: 30_000 });

  await signOut(page);
  await logIn(page, email, PASS);
  await expect(page.getByText("Wrong email or password.", { exact: true })).toBeVisible();
  await logIn(page, email, NEW_PASS);
  await expect(page).toHaveURL(/\/(account|onboarding)/, { timeout: 30_000 });
  expect((await me(page)).user?.email).toBe(email);
});
