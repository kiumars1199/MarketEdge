// Marc's QA list #33 (Nov 20): signed out, a URL that is no page shows the 404 page (header, footer, disclaimer),
// not a redirect to /signup. The app's real pages still go to sign-up.
import { expect, test } from "@playwright/test";

test("#33 signed out: unknown URLs are a 404 page; app pages still ask for an account", async ({ page }) => {
  for (const p of ["/nope-xyz", "/pricingx", "/some/deep/path"]) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBe(404);
    expect(new URL(page.url()).pathname, p).toBe(p);
    await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
    await expect(page.getByText("Market analytics, not financial advice. Based on past results. 18+.").first()).toBeVisible();
  }
  for (const p of ["/bets", "/account", "/kalshi"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(new RegExp(`/signup\\?next=%2F${p.slice(1)}$`));
  }
});
