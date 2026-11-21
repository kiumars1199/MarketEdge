// T-302 (docs/OVERHAUL.md §B, §G1, §G2): the plain-language Best bets card and page, in a real browser.
//
// Seven-slot rule, as checked here: on a card, every visible text node outside "Why this bet?" ([data-testid=why]) sits
// inside an element carrying data-slot, and a card has at most 7 distinct slots (title, side, chance, value, money,
// closes, bet). A text node counts as visible when its element has a non-zero box and is not visibility:hidden.
import { expect, test, type Page } from "@playwright/test";
import { bannedHits, readableText } from "../lib/banned";

type Probe = { id: string; venue: string; slots: string[]; loose: string[] };
const probe = (page: Page) =>
  page.locator("article[data-testid=bet-card]").evaluateAll((cards) =>
    cards.map((card) => {
      const slots = new Set<string>();
      const loose: string[] = [];
      const walk = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const t = n.textContent?.trim();
        const el = n.parentElement!;
        if (!t || el.closest("[data-testid=why]")) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
        const slot = el.closest("[data-slot]");
        if (slot) slots.add(slot.getAttribute("data-slot")!);
        else loose.push(t);
      }
      return { id: card.getAttribute("data-market-id")!, venue: card.getAttribute("data-venue")!, slots: [...slots], loose };
    }));

test("every card face: at most 7 slots, no loose text, 'Why this bet?' starts with the payout line", async ({ page }) => {
  for (const url of ["/", "/?us=0"]) {
    await page.goto(url);
    await expect(page.locator("article[data-testid=bet-card]").first()).toBeVisible();
    const cards: Probe[] = await probe(page);
    expect(cards.length).toBeGreaterThan(4);
    for (const c of cards) {
      expect(c.loose, `${url} ${c.id}`).toEqual([]);
      expect(c.slots.length, `${url} ${c.id}: ${c.slots}`).toBeLessThanOrEqual(7);
    }
  }
  const card = page.locator("article[data-testid=bet-card]").first();
  await expect(card.getByTestId("card-money")).toContainText(/^Pays [\d.]+x/);
  await card.getByText("Why this bet?").click();
  const back = card.getByTestId("why-back");
  await expect(back.locator("p")).toHaveText(/^If it wins you get \$[\d,.]+ back \(\$10 \+ \$[\d,.]+\)$/);
  // the amount is the user's: typing $25 reprices the line
  await back.getByLabel(/If you bet/).fill("25");
  await expect(back.locator("p")).toHaveText(/^If it wins you get \$[\d,.]+ back \(\$25 \+ \$[\d,.]+\)$/);
  await expect(page.locator("main")).not.toContainText(/\bTo win\b/);
});

test("venue: a US quote gets 'Bet on Polymarket US' to its US link; us null gets no primary button", async ({ page, request }) => {
  const { rows } = await (await request.get("/api/flags?us=0&ps=200&g=0")).json();
  const us = new Map<string, { url: string } | null>(rows.map((r: { market: { id: string; us: { url: string } | null } }) => [r.market.id, r.market.us]));
  await page.goto("/?us=0&g=0&ps=50");
  await expect(page.locator("article[data-testid=bet-card]").first()).toBeVisible();
  const cards = await page.locator("article[data-testid=bet-card]").evaluateAll((els) => els.map((e) => ({
    id: e.getAttribute("data-market-id")!,
    venue: e.getAttribute("data-venue"),
    buttons: [...e.querySelectorAll("[data-testid=venue-button]")].map((b) => ({ href: b.getAttribute("href"), text: b.textContent?.trim() })),
    intlOnly: e.querySelector("[data-testid=intl-only]")?.textContent?.trim() ?? null,
  })));
  let onUs = 0, off = 0;
  for (const c of cards) {
    const q = us.get(c.id);
    if (q) {
      onUs++;
      expect(c.venue, c.id).toBe("us");
      expect(c.buttons, c.id).toEqual([{ href: q.url, text: "Bet on Polymarket US" }]);
      for (const b of c.buttons) expect(b.href, c.id).not.toMatch(/^https:\/\/(www\.)?polymarket\.com/);
    } else if (q === null) {
      off++;
      expect(c.venue, c.id).toBe("intl-only");
      expect(c.buttons, c.id).toEqual([]);
      expect(c.intlOnly, c.id).toBe("International only, not on Polymarket US");
    }
  }
  expect(onUs).toBeGreaterThan(0);
  expect(off).toBeGreaterThan(0);
  // the international link lives inside "Why this bet?", with the warning
  const intl = page.locator("article[data-venue=intl-only]").first();
  await intl.getByText("Why this bet?").click();
  await expect(intl.getByTestId("why-intl")).toContainText("Not available to US residents");
  await expect(intl.getByTestId("why-intl").getByRole("link", { name: "Open on international Polymarket" })).toHaveAttribute("href", /polymarket\.com/);
});

test("/bets reads plainly: no banned words, Today's top 5 then More bets", async ({ page, request }) => {
  for (const path of ["/bets", "/"]) {
    const html = await (await request.get(path)).text();
    expect(bannedHits(readableText(html)), path).toEqual([]);
  }
  await page.goto("/bets");
  const h2 = page.locator("main h2");
  await expect(h2.filter({ hasText: /^Today's top \d$/ })).toHaveCount(1);
  await expect(h2.filter({ hasText: /^More bets$/ })).toHaveCount(1);
  await expect(page.getByTestId("big-payouts")).toHaveCount(0);
  await expect(page.getByTestId("more-edge")).toHaveCount(0);
  // the filter sheet's words are not on the page until it opens
  expect(await page.locator("dialog[aria-label=Filters]").innerText()).not.toContain("Min price gap");
});

test("'On Polymarket US' is on by default; turning it off includes international bets", async ({ page, request }) => {
  const on = await (await request.get("/api/flags")).json();
  const off = await (await request.get("/api/flags?us=0")).json();
  expect(off.total).toBeGreaterThan(on.total);
  await page.goto("/");
  const chip = page.getByTestId("us-chip");
  await expect(chip).toHaveText("On Polymarket US");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${on.total} bets`);
  for (const v of await page.locator("article[data-testid=bet-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-venue")))) expect(v).toBe("us");
  await chip.click();
  await expect(page).toHaveURL(/[?&]us=0/);
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${off.total} bets`);
  // also in the filter sheet
  await page.getByRole("button", { name: /^More filters/ }).click();
  await expect(page.getByRole("dialog", { name: "Filters" }).getByRole("checkbox", { name: "On Polymarket US only" })).not.toBeChecked();
});

// Mark's filter bar (Nov 20): Sport · Multiplier · Date apply together on Apply; the count and Sort sit under it.
test("filter bar: three dropdowns land in the URL on Apply, and stay after a reload", async ({ page }) => {
  await page.goto("/");
  const bar = page.getByTestId("filter-bar");
  await expect(bar).toBeVisible();
  await page.waitForLoadState("networkidle");   // hydrated: the selects' handlers are attached
  await bar.getByTestId("bar-sport").selectOption("t:sports.soccer");
  await bar.getByTestId("bar-mult").selectOption("1.5-2");
  await bar.getByTestId("bar-date").selectOption("week");
  await expect(page).not.toHaveURL(/t=sports\.soccer/);   // nothing moves until Apply
  await bar.getByTestId("bar-apply").click();
  await expect(page).toHaveURL(/t=sports\.soccer/);
  await expect(page).toHaveURL(/x0=1\.5/);
  await expect(page).toHaveURL(/x1=2/);
  await expect(page).toHaveURL(/cw=/);
  // the bar shows them, so no duplicate pills
  await expect(page.getByLabel("Applied filters").getByRole("button", { name: /Closes|Pays|Soccer/ })).toHaveCount(0);
  await page.reload();
  await expect(bar.getByTestId("bar-sport")).toHaveValue("t:sports.soccer");
  await expect(bar.getByTestId("bar-mult")).toHaveValue("1.5-2");
  await expect(bar.getByTestId("bar-date")).toHaveValue("week");
  await expect(page.getByTestId("bar-count")).toContainText(/\d+ bets?/);
});

test("sort menu changes the order in the URL", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("bar-sort").selectOption("win_prob");
  await expect(page).toHaveURL(/win_prob/);
});

test("a filter set outside the bar keeps its removable pill", async ({ page }) => {
  await page.goto("/?wp=0.6");
  await expect(page.getByRole("button", { name: /^Remove filter: Chance ≥ 60/ })).toBeVisible();
});

for (const [w, h] of [[390, 844], [1440, 900]] as const) {
  test(`tap targets at ${w}px: chips and controls 44px, bet button 48px full width on phones`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    await expect(page.locator("article[data-testid=bet-card]").first()).toBeVisible();
    const small = await page.evaluate(() => {
      const sel = [
        "[data-testid=filter-bar] select", "[data-testid=bar-apply]", "[data-testid=bar-sort]", "[aria-label='More filters'] button", "article[data-testid=bet-card] h3 a", "article[data-testid=bet-card] summary",
        "[data-testid=venue-button]", "[aria-label='Applied filters'] button",
      ].join(",");
      return [...document.querySelectorAll<HTMLElement>(sel)]
        .map((e) => ({ t: (e.textContent ?? "").trim().slice(0, 40), h: e.getBoundingClientRect().height }))
        .filter((x) => x.h > 0 && x.h < 44);
    });
    expect(small).toEqual([]);
    if (w < 640) {
      const card = page.locator("article[data-testid=bet-card]").first();
      const [btn, box] = [await card.getByTestId("venue-button").boundingBox(), await card.boundingBox()];
      expect(btn!.height).toBeGreaterThanOrEqual(48);
      expect(btn!.width).toBeGreaterThan(box!.width - 40);   // full width inside the card's padding
    }
  });
}

// QA-B (Marc #55): the card's one return figure sits in the value slot; at 390×844 the card still has at most 7 slots,
// no slot is wider than its card, and the page has no sideways scroll.
test("390×844: one return figure in the value slot, 7 slots, nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ["/", "/?us=0"]) {
    await page.goto(url);
    await expect(page.locator("article[data-testid=bet-card]").first()).toBeVisible();
    for (const c of await probe(page)) expect(c.slots.length, `${url} ${c.id}`).toBeLessThanOrEqual(7);
    await expect(page.getByTestId("card-return").first()).toContainText(/est\. return$/);
    const over = await page.evaluate(() => {
      const bad: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth) bad.push(`page ${document.documentElement.scrollWidth}`);
      for (const card of document.querySelectorAll("article[data-testid=bet-card]")) {
        const cr = card.getBoundingClientRect();
        for (const el of card.querySelectorAll("[data-slot]")) {
          if (el.closest("[data-testid=why]")) continue;
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > cr.right + 1 || r.left < cr.left - 1)) bad.push(`${card.getAttribute("data-market-id")} ${el.getAttribute("data-slot")}`);
        }
      }
      return bad;
    });
    expect(over, url).toEqual([]);
  }
});
