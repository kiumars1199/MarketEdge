import { expect, test, type Page } from "@playwright/test";

// T-288: clock times use the visitor's zone on the first paint, never a UTC flash, and hydrate without React #418.
// First visit: no zone known yet (no cookie, no x-vercel-ip-timezone) → a hidden same-width placeholder until mount.
// The page then saves the browser zone (POST /api/tz, HttpOnly cookie); from the next load the server renders local times.

const ZONES = ["America/New_York", "Asia/Tokyo"] as const;

const gameTexts = (html: string) => [...html.matchAll(/data-game="">([^<]*)</g)].map((m) => m[1]);
const watch = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  return () => errors.filter((e) => /#418|#423|#425|hydrat|did not match/i.test(e));
};

for (const timezoneId of ZONES) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });

    test("first visit: placeholder, then the cookie makes the next first paint local", async ({ page, request }) => {
      const { rows } = await (await request.get("/api/flags?ps=1")).json();
      const path = `/m/${rows[0].market.id}`;
      const hydrationErrors = watch(page);

      const saved = page.waitForResponse((r) => r.url().endsWith("/api/tz") && r.status() === 204);
      await page.goto(path);
      await saved;
      const cookie = (await page.context().cookies()).find((c) => c.name === "tz");
      expect(cookie?.value && decodeURIComponent(cookie.value)).toBe(timezoneId);
      expect(cookie?.httpOnly).toBe(true);

      // second load: first-paint HTML already carries the times the browser shows after hydration
      const html = await (await page.request.get(path)).text();
      expect(html).not.toContain("data-time-pending");
      const served = gameTexts(html);
      expect(served.length).toBeGreaterThan(0);
      await page.goto(path);
      const shown = await page.locator("[data-game]").allInnerTexts();
      expect(shown.slice(0, served.length)).toEqual(served);
      expect(hydrationErrors()).toEqual([]);
    });

    test("the edge zone header is used when there is no cookie", async ({ browser, request }) => {
      const { rows } = await (await request.get("/api/flags?ps=1")).json();
      const ctx = await browser.newContext({ timezoneId, extraHTTPHeaders: { "x-vercel-ip-timezone": timezoneId } });
      const page = await ctx.newPage();
      const hydrationErrors = watch(page);
      for (const path of ["/", "/bets", "/markets", `/m/${rows[0].market.id}`]) {
        const res = await page.goto(path);
        const html = (await res!.text());
        expect(html, path).not.toContain("data-time-pending");
        await page.waitForLoadState("load");
        await page.waitForTimeout(1000); // let hydration finish; the app polls, so networkidle never comes
      }
      expect(hydrationErrors()).toEqual([]);
      await ctx.close();
    });
  });
}

test("no zone known: times hidden until mount, no hydration error", async ({ browser, request }) => {
  const { rows } = await (await request.get("/api/flags?ps=1")).json();
  const ctx = await browser.newContext({ timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  const hydrationErrors = watch(page);
  const res = await page.goto(`/m/${rows[0].market.id}`);
  const html = await res!.text();
  expect(html).toContain("data-time-pending");
  expect(gameTexts(html)).toEqual([]);
  await expect(page.locator("[data-game]").first()).toBeVisible();
  expect(hydrationErrors()).toEqual([]);
  await ctx.close();
});
