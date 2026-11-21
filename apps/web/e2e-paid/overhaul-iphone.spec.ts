// docs/OVERHAUL.md §D: signed-out pages on iPhone sizes (DEMO_MODE=false here, so / is the landing).
import { test } from "@playwright/test";
import { checkPage } from "../e2e/iphone/iphone";

for (const url of ["/", "/pricing", "/about", "/track-record", "/signup", "/login", "/reset-password", "/terms"])
  test(`iPhone signed out ${url}`, async ({ page }, info) => {
    await page.context().clearCookies();
    await checkPage(page, url, info);
  });
