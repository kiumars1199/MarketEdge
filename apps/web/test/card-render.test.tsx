// T-302 (docs/OVERHAUL.md §B, §G1): render the Best bets card for every fixture best bet, exact (Pro) and banded
// (Free), and check its words: no banned jargon anywhere on it (lib/banned.ts, "Why this bet?" included), at most seven
// face slots, the $10 line outside and the payout line first inside "Why this bet?", never "To win", and the venue rule:
// a US quote gets "Bet on Polymarket US" to us.url, us === null gets "International only" and no primary button.
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
const { backLine, cardVenue, INTL_ONLY, paysLine, US_SMALL_PRINT } = await import("@/lib/card");
const { bannedHits, readableText } = await import("@/lib/banned");
const { gateMarket } = await import("@/lib/data/gate");
const { getStore } = await import("@/lib/data/store");
const store = await getStore();

const render = (m: StoreMarket) => renderToStaticMarkup(createElement(BetCard, { r: { market: m, side: m.best } as ApiRow }));
const slots = (html: string) => new Set([...html.matchAll(/data-slot="([^"]+)"/g)].map((x) => x[1]));
const why = (html: string) => html.slice(html.indexOf('data-testid="why"'));

describe("BetCard on every fixture best bet", () => {
  const cases = store.flags.flatMap((m) => [{ m, tier: "exact" }, { m: gateMarket(m, "free"), tier: "free" }]);

  it("covers both venues", () => {
    expect(store.flags.some((m) => m.us)).toBe(true);
    expect(store.flags.some((m) => m.us === null)).toBe(true);
  });

  for (const { m, tier } of cases) {
    it(`${m.id} ${tier}`, () => {
      const html = render(m);
      const text = readableText(html);
      expect(bannedHits(text), text).toEqual([]);
      expect(text).not.toMatch(/\bTo win\b/);
      expect(slots(html).size).toBeLessThanOrEqual(7);
      const v = cardVenue(m, m.best);
      const face = html.slice(0, html.indexOf('data-testid="why"'));
      if (paysLine(v)) expect(readableText(face)).toContain(paysLine(v)!);
      if (backLine(v)) expect(readableText(why(html)).indexOf(backLine(v)!)).toBeGreaterThan(-1);
      if (v.kind === "us") {
        expect(face).toContain(`href="${m.us!.url}"`);
        expect(readableText(face)).toContain("Bet on Polymarket US");
        if (v.ask != null) expect(readableText(face)).toContain(US_SMALL_PRINT);
        expect(face).not.toMatch(/href="https:\/\/polymarket\.com/);
      } else if (v.kind === "intl-only") {
        expect(readableText(face)).toContain(INTL_ONLY);
        expect(face).not.toContain('data-testid="venue-button"');
        expect(readableText(why(html))).toContain("Not available to US residents");
      }
    });
  }
});
