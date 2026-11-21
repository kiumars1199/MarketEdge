// docs/15 § Paywall (Lane X) + T-276 account wall: a signed-out visitor gets the sales pages and teasers only.
// The data APIs answer 401, app pages redirect to /signup?next=<page>, and the HTML + RSC payload of every public
// page carries no more than the Free tier allows (the landing's 3 real cards) and no model output on teasers.
import { expect, test, type Page } from "@playwright/test";
import flagsFixture from "../test/fixtures/flags.json";

const PAID_ONLY = ["capacity_usd", "limit_price", "limit_edge", "retention", "\"theta\"", "\"cov\""];
const TEASER_LINE = "Kismet has a verdict on this market. Sign up free to see it.";
const fixture = flagsFixture as unknown as { flags: { id: string; event_id: string }[] };
const m = fixture.flags[0]!;

test("signed out: data APIs are 401, app pages redirect with next, public pages carry no paid fields", async ({ page, request }) => {
  for (const api of ["/api/flags?ps=200", "/api/markets", `/api/markets/${m.id}`, `/api/events/${m.event_id}`, "/api/suggest?q=a"]) {
    const res = await request.get(api);
    expect(res.status(), api).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Sign in to use this." });
  }
  for (const path of ["/bets", "/markets", "/watchlist", "/tools", "/account", `/?m=${m.id}`]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(new URL(res.headers()["location"]!, "http://x").pathname + new URL(res.headers()["location"]!, "http://x").search, path)
      .toBe(`/signup?next=${encodeURIComponent(path)}`);
  }

  for (const path of ["/", "/about", "/pricing", "/track-record", `/m/${m.id}`, `/event/${m.event_id}`]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    const html = await res.text();
    for (const k of PAID_ONLY) expect(html, `${path} carries ${k}`).not.toContain(k);
    // Side objects in the RSC payload (escaped JSON) must carry their bands.
    const sides = html.match(/\\"side_index\\":[01]/g)?.length ?? 0;
    const ranges = html.match(/\\"ranges\\":\{/g)?.length ?? 0;
    expect(ranges, `${path}: every side has ranges`).toBeGreaterThanOrEqual(sides);
  }

  // Teasers: title and sign-up, no verdict, price or model field anywhere in the HTML.
  for (const path of [`/m/${m.id}`, `/event/${m.event_id}`]) {
    const html = await (await request.get(path)).text();
    expect(html).toContain(TEASER_LINE);
    for (const k of ["side_index", "win_prob", "\\\"ask\\\"", "\\\"edge\\\"", "Pays "]) expect(html, `${path} carries ${k}`).not.toContain(k);
  }

  // docs/19 P1 + T-301: the landing. Up to 1 + 3 real cards (the Free gate's rows), no blurred placeholders.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which Polymarket bets are worth it today?");
  const cards = page.locator("[data-row]");
  expect(await cards.count()).toBeLessThanOrEqual(4);
  if (await cards.count()) await expect(cards.first()).toContainText(/–|under|over/);   // a band, not an exact figure
  await expect(page.getByTestId("placeholder")).toHaveCount(0);
  await expect(page.getByTestId("landing-cta")).toHaveAttribute("href", "/signup");

  await page.goto("/about");
  const card = page.getByTestId("preview-card").first();
  if (await card.count()) await expect(card).toContainText(/–|under|over/);
});

test("signed out: public pages make no API call that gets a 401", async ({ page }) => {
  const denied: string[] = [];
  page.on("response", (r) => {
    if (r.status() === 401 && new URL(r.url()).pathname.startsWith("/api/")) denied.push(r.url());
    // a script, image, font or fetch a public page needs must not be bounced to the sign-up page by the wall
    if (r.request().resourceType() !== "document" && r.status() >= 300 && r.status() < 400 && (r.headers()["location"] ?? "").includes("/signup")) denied.push(`${r.url()} → sign-up`);
  });
  for (const path of ["/", "/pricing", "/about", "/track-record", "/status", `/m/${m.id}`, `/event/${m.event_id}`, "/signup", "/login"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(denied).toEqual([]);
  // Signed-out header: the sales pages and sign-up, not the app tabs, search or alerts.
  await page.goto("/pricing");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("banner").getByRole("link", { name: "Pricing" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Best bets" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Alerts/ })).toHaveCount(0);
});

async function signUpWithPassword(page: Page, email: string) {
  await page.waitForLoadState("networkidle");   // the form submits with fetch once hydrated
  await expect(page.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator("input").and(page.getByLabel("Password", { exact: true })).fill("round trip pass 1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  const { url } = await (await page.request.get(`/e2e-mock/supabase/_inbox?email=${encodeURIComponent(email)}`)).json();
  expect(url).toContain("/auth/callback");
  await page.goto(url);
}

test("redirect with next: a signed-out deep link → sign up → onboarding → back on that page", async ({ page }) => {
  test.setTimeout(180_000);
  const target = "/markets?sort=edge";
  await page.goto(target);
  await expect(page).toHaveURL(`/signup?next=${encodeURIComponent(target)}`);
  await expect(page.getByText("10 best bets a day free, no card.", { exact: false })).toBeVisible();

  await signUpWithPassword(page, `rt-${Date.now()}@example.com`);
  await expect(page).toHaveURL(`/onboarding?next=${encodeURIComponent(target)}`);   // new account: the tour first
  await expect(async () => {
    if (new URL(page.url()).pathname === "/onboarding") await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(target, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });

  // Signed in now: the data APIs answer, / is Best bets, and /m/<id> is the full market page.
  expect((await page.request.get("/api/flags")).status()).toBe(200);
  await page.goto("/");
  await expect(page.locator("[data-row]").first()).toBeVisible({ timeout: 30_000 });
  await page.goto(`/m/${m.id}`);
  await expect(page.getByTestId("teaser")).toHaveCount(0);
});
