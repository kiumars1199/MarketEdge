// QA-B (Marc, Nov 20, #55/#31/#20/#37/#54): one bet shows ONE payout and ONE return. For every fixture best bet, exact
// and as Free sees it, the card's return must be what its own numbers give (win chance × payout − 1, to the rounding
// of what is printed), and the card, "Why this bet?", the stake box and the compact card must print the same payout
// and return. Free shows bands: there the formula over the band of possible win chances must reach the return band,
// and the arithmetic line (an exact figure) must not appear.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiRow } from "@/lib/api";
import type { StoreMarket } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
}));

const { BetCard } = await import("@/components/market/BetCard");
const { MarketCard } = await import("@/components/market/MarketCard");
const { atQuote, betQuote, betFigures, verdict } = await import("@/lib/betFigures");
const { gateMarket } = await import("@/lib/data/gate");
const { getStore } = await import("@/lib/data/store");
const store = await getStore();

const testid = (html: string, id: string) => {
  const m = new RegExp(`data-testid="${id}"[^>]*>(.*?)</(?:span|p)>`, "s").exec(html);
  return m ? m[1]!.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").trim() : null;
};
const num = (t: string) => Number(t.replace("−", "-").replace(/[^\d.+-]/g, ""));
/** Half of the last printed digit: the most rounding can move a printed figure. */
const halfPays = (x: number) => (x >= 100 ? 0.5 : x >= 10 ? 0.05 : 0.005);
const halfRet = (r: number) => (Math.abs(r) >= 10 ? 0.5 : 0.05);

describe("one payout and one return per bet, on every fixture best bet", () => {
  const cases = store.flags.flatMap((m) => [{ m: m as StoreMarket, tier: "exact" }, { m: gateMarket(m, "free") as StoreMarket, tier: "free" }]);
  let exactChecked = 0, freeChecked = 0;

  for (const { m, tier } of cases) {
    it(`${m.id} ${tier}`, () => {
      const s = m.best;
      const q = betQuote(m, s);
      const r = { market: m, side: s } as ApiRow;
      const html = renderToStaticMarkup(createElement(BetCard, { r }));
      if (q.paysText === null) return;   // listed on Polymarket US with no US price: no figures to compare

      // the card's figures are the quote's
      const cardRet = testid(html, "card-return");
      const money = testid(html, "card-money");
      const chance = testid(html, "card-chance")!;
      expect(cardRet, "card return").toBe(`${q.retText} est. return`);
      expect(money, "card pays").toContain(`Pays ${q.paysText}`);

      // "Why this bet?" repeats them, and the stake box pays $10 × the card's payout
      expect(testid(html, "why-pays-x"), "drawer pays").toBe(q.paysText);
      expect(testid(html, "why-return"), "drawer return").toBe(q.retText);
      const back = /If it wins you get \$([\d,.]+) back/.exec(html);
      expect(back, "stake box").not.toBeNull();
      const shownPays = num(q.paysText);
      expect(Math.abs(num(back![1]!) - 10 * shownPays), "stake box = $10 × card payout").toBeLessThanOrEqual(10 * halfPays(shownPays) + 0.005 + 1e-9);

      // the compact card (screener, My list) prints the same pair
      const compact = renderToStaticMarkup(createElement(MarketCard, { r }));
      expect(compact, "compact pays").toContain(`Pays ${q.paysText}`);
      expect(compact, "compact return").toContain(q.retText.replace("–", "–"));
      expect(betFigures(s, { market: m }).ret.text).toBe(q.retText);

      // #5: labels come from the same number they sit beside. An exact return of 0 or below gets no stars and no
      // positive verdict; Free never gets the exact arithmetic, in any text or hover (betQuote().math is its only source).
      const at = atQuote(s, q);
      if (tier === "exact") {
        const nonPos = q.roi !== null && q.roi <= 0;
        if (nonPos) {
          expect(html, "no stars beside a return ≤ 0").not.toMatch(/aria-label="Value:/);
          expect(verdict(at).tone, "no positive verdict beside a return ≤ 0").not.toBe("up");
        } else if (q.roi !== null) {
          expect(html, "stars beside a positive return").toMatch(/aria-label="Value: (Great|Good|Fair) value/);
          expect(verdict(at).tone).toBe("up");
        }
      } else {
        expect(q.math, "Free: no exact arithmetic").toBeNull();
      }

      if (/Over|Under/.test(chance)) return;   // "Over 99%": no exact chance printed to multiply
      const c = num(chance) / 100;
      if (tier === "exact") {
        // shown return = shown chance × shown payout − 1, to the rounding of each printed figure
        const shownRet = num(q.retText);
        const bound = 100 * (0.005 * shownPays + c * halfPays(shownPays)) + halfRet(shownRet) + 1e-6;
        expect(Math.abs(shownRet - (c * shownPays - 1) * 100), `${chance} × ${q.paysText} − 1 vs ${q.retText}`).toBeLessThanOrEqual(bound);
        expect(testid(html, "why-math"), "arithmetic shown").toContain(q.retText);
        exactChecked++;
      } else {
        // Free: win chance is floored to 5%, return is a band. The formula over [floor, floor + 5%) must reach the band.
        const lo = (c * (shownPays - halfPays(shownPays)) - 1) * 100;
        const hi = ((c + 0.05) * (shownPays + halfPays(shownPays)) - 1) * 100;
        const band = q.venue === "us" ? null : s.ranges!.roi_pct;
        const cuts = [0, 5, 10, 20, 50];   // lib/data/gate.ts ROI: a Free US quote carries its band's low end
        const [blo, bhi] = band ?? (q.roi! < 0 ? [null, 0] : [q.roi!, cuts.find((x) => x > q.roi!) ?? null]);
        expect(hi, `${chance}+5% × ${q.paysText} reaches ${q.retText}`).toBeGreaterThanOrEqual((blo ?? -Infinity) - 1e-6);
        if (bhi !== null) expect(lo, `${chance} × ${q.paysText} under ${q.retText}`).toBeLessThanOrEqual(bhi + 1e-6);
        expect(html, "no exact arithmetic on Free").not.toContain('data-testid="why-math"');
        freeChecked++;
      }
    });
  }

  it("checked most bets both ways", () => {
    expect(exactChecked).toBeGreaterThan(100);
    expect(freeChecked).toBeGreaterThan(100);
  });
});

describe("the return is the formula, before display rounding", () => {
  it("roi = win chance ÷ (price + fee) − 1 at the card's price, on every fixture side and US quote", () => {
    for (const m of store.flags) {
      for (const s of m.sides) {
        const q = betQuote(m, s);
        if (q.pays === null || q.roi === null) continue;
        expect(Math.abs(q.roi - (s.win_prob * q.pays - 1) * 100), `${m.id}/${s.side_index} ${q.venue}`).toBeLessThan(0.05);
      }
    }
  });
});
