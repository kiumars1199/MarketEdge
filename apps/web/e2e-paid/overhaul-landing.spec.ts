// docs/OVERHAUL.md §A (T-301): the signed-out landing. Signed-out / exists only with DEMO_MODE=false, so this runs in
// the paid config (in-app Supabase/Stripe mock). Checks: no banned word or big count in the server HTML or the
// hydrated page (title + meta included), sections in order, one primary button and a real bet card in the first screen
// at 390×844 and 1440×900 (R1-1, R1-3, R1-4).
// LANDING_SHOTS=1 also writes the first-screen and full-page screenshots to docs/overhaul-evidence/A/.
import { expect, test, type Page } from "@playwright/test";
import { bannedHits, readableText } from "../lib/banned";

const SIZES = [{ width: 390, height: 844 }, { width: 1440, height: 900 }] as const;
const ORDER = ["landing-hero", "landing-cta", "landing-hero-bet", "landing-steps", "landing-bets", "landing-plans", "landing-faq", "landing-results"];
const CARD = '[data-testid="bet-card"], [data-row]';   // lane B's card wrapper, and today's

test("server HTML of / has no banned word or count above 3 digits", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain('data-testid="landing-hero"');
  expect(bannedHits(readableText(html), { counts: true })).toEqual([]);
});

/** What a visitor reads after hydration: page text + title + every description meta. */
async function domText(page: Page, scope = "body", skip?: string): Promise<string> {
  return page.evaluate(([scope, skip]) => {
    const root = document.querySelector(scope)!.cloneNode(true) as HTMLElement;
    if (skip) root.querySelectorAll(skip).forEach((n) => n.remove());
    const live = document.querySelector(scope) as HTMLElement;
    const text = skip ? (document.body.appendChild(root), root.innerText) : live.innerText;
    if (skip) root.remove();
    // the same metas lib/banned readableText reads (og:image:width etc. are not text a visitor reads)
    const metas = [...document.querySelectorAll('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"], meta[property="og:title"], meta[name="twitter:title"]')]
      .map((m) => m.getAttribute("content") ?? "");
    return [document.title, ...metas, text].join("\n");
  }, [scope, skip ?? ""] as const);
}

for (const size of SIZES) {
  test(`landing at ${size.width}×${size.height}: words, order, first screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which Polymarket bets are worth it today?");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "no sideways scroll").toBeLessThanOrEqual(0);
    // §A: no stats table and no chart anywhere on the landing
    await expect(page.locator("main").locator("table, [role=table], [role=grid], .recharts-wrapper, canvas, svg[aria-label*=chart i]")).toHaveCount(0);

    // Banned words: the whole hydrated page, and (so a card regression is told apart) the page without bet cards.
    expect(bannedHits(await domText(page, "main", CARD), { counts: true }), "landing's own text").toEqual([]);
    expect.soft(bannedHits(await domText(page), { counts: true }), "whole page").toEqual([]);   // soft: the checks below still run

    // Order: hero (headline, button, card) → 3 steps → 3 bets → plans → FAQ → results link.
    const ys: number[] = [];
    for (const id of ORDER) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      ys.push(box!.y);
    }
    if (size.width >= 1024) {   // the hero card sits beside the text on desktop: compare from the steps on
      expect(ys.slice(3)).toEqual([...ys.slice(3)].sort((a, b) => a - b));
      expect(ys[0]!).toBeLessThan(ys[3]!);
    } else expect(ys).toEqual([...ys].sort((a, b) => a - b));
    await expect(page.getByTestId("landing-steps").locator("ol > li")).toHaveCount(3);
    await expect(page.getByTestId("landing-bets").locator("ul > li")).toHaveCount(3);
    await expect(page.getByTestId("landing-faq").locator("details")).toHaveCount(5);
    const results = page.getByTestId("landing-results").getByRole("link");
    await expect(results).toHaveText("See how we track results");
    await expect(results).toHaveAttribute("href", "/track-record");

    // First screen: exactly one primary button in the page body (cards' own bet buttons aside), and it's Sign up free.
    // The header's and the phone tab bar's "Sign up" are the shell's, not the page's.
    const primaries = await page.locator("main").evaluate((main, card) => {
      const out: string[] = [];
      for (const el of main.querySelectorAll<HTMLElement>("a, button")) {
        if (el.closest(card)) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.top < innerHeight && r.bottom > 0 && /(^|\s)bg-accent(\s|$)/.test(el.className)) out.push(el.innerText.trim());
      }
      return out;
    }, CARD);
    expect(primaries).toEqual(["Sign up free"]);
    await expect(page.getByTestId("landing-no-risk")).toHaveText("10 bets a day, free. No card.");
    const cta = (await page.getByTestId("landing-cta").boundingBox())!;
    expect(cta.height).toBeGreaterThanOrEqual(48);   // R2-8: bigger than the 44 px minimum

    // A real bet card in the first screen: whole at 1440×900, starting above the phone's tab bar at 390×844.
    const card = (await page.getByTestId("landing-hero-bet").locator(CARD).first().boundingBox())!;
    expect(card, "hero bet card").toBeTruthy();
    if (size.width >= 1024) expect(card.y + card.height, "card fits the first screen").toBeLessThanOrEqual(size.height);
    else {
      const bar = await page.locator("nav.fixed").first().boundingBox();
      const fold = bar ? bar.y : size.height;
      expect(card.y + 40, "card starts within the first screen").toBeLessThan(fold);
    }

    if (process.env.LANDING_SHOTS) {
      const dir = "../../docs/overhaul-evidence/A";
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${dir}/home-${size.width}x${size.height}.png` });
      await page.screenshot({ path: `${dir}/home-${size.width}x${size.height}-full.png`, fullPage: true });
    }
  });
}
