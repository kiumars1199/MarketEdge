// T-302 lib/card.ts: plain titles, the one-denominator chance, the $10 line, stars and the venue a card shows
// (docs/OVERHAUL.md §B, §G1; rules R2-1, R2-4).
import { describe, expect, it } from "vitest";
import { backLine, cardVenue, plainTitle, sideLabel, stars, winsInTen, winsLine } from "@/lib/card";
import { bannedHits } from "@/lib/banned";
import { gateMarket } from "@/lib/data/gate";
import type { Market, Side, StoreMarket } from "@/lib/types";

const { getStore } = await import("@/lib/data/store");
const store = await getStore();

type Q = Pick<Market, "question" | "event" | "category" | "niche" | "market_type">;
const mk = (question: string, extra: Partial<Q> = {}): Q => ({ question, event: question, category: "sports", niche: "nfl", market_type: "moneyline", ...extra });
const side = (outcome: string, side_index: 0 | 1 = 0) => ({ outcome, side_index });
const title = (q: string, outcome: string, extra: Partial<Q> = {}, i: 0 | 1 = 0) => plainTitle(mk(q, extra), side(outcome, i));

describe("plainTitle", () => {
  it("win: 'Will X FC win on <date>?' reads as a team to win; No names the other side", () => {
    const soccer = { event: "Coventry City FC vs. Crystal Palace FC", niche: "soccer" };
    expect(title("Will Crystal Palace FC win on 2026-11-21?", "Yes", soccer)).toBe("Crystal Palace to win");
    expect(title("Will Crystal Palace FC win on 2026-11-21?", "No", soccer, 1)).toBe("Coventry City to win or draw");
    expect(title("Will Crystal Palace FC win on 2026-11-21?", "No", { event: "Crystal Palace FC" }, 1)).toBe("Crystal Palace not to win");
  });

  it("draw", () => {
    expect(title("Will Hungary vs. Northern Ireland end in a draw?", "Yes")).toBe("Hungary vs Northern Ireland to end in a draw");
    expect(title("Will Hungary vs. Northern Ireland end in a draw?", "No", {}, 1)).toBe("Hungary or Northern Ireland to win");
  });

  it("over/under in whole units, by sport; team totals, halves and player props", () => {
    expect(title("Dolphins vs. Bills: O/U 52.5", "Over")).toBe("Dolphins vs Bills: 53 or more points");
    expect(title("Dolphins vs. Bills: O/U 52.5", "Under", {}, 1)).toBe("Dolphins vs Bills: 52 or fewer points");
    expect(title("Denmark vs. Norway: O/U 2.5", "Over", { niche: "soccer" })).toBe("Denmark vs Norway: 3 or more goals");
    expect(title("Denmark vs. Norway: 1st Half O/U 0.5", "Under", { niche: "soccer" }, 1)).toBe("Denmark vs Norway: no goals in the 1st half");
    expect(title("Wales vs. Portugal: Wales 1st Half O/U 0.5", "Over", { niche: "soccer" })).toBe("Wales to score 1 or more goals in the 1st half");
    expect(title("Steelers Team Total: O/U 20.5", "Over")).toBe("Steelers to score 21 or more points");
    expect(title("Jalen Green: Assists O/U 1.5", "Yes", { niche: "nba" })).toBe("Jalen Green: 2 or more assists");
    expect(title("O/U 2.5 Rounds", "Over", { event: "UFC Fight Night: Kyoji Horiguchi vs. Asu Almabayev", niche: "ufc" })).toBe("Kyoji Horiguchi vs Asu Almabayev: over 2.5 rounds");
  });

  it("spread: the favourite wins by N or more, the other side wins or loses by less", () => {
    expect(title("Spread: Texans (-3.5)", "Texans")).toBe("Texans to win by 4 or more points");
    expect(title("Spread: Texans (-3.5)", "Colts", {}, 1)).toBe("Colts to win, or lose by 3 or less");
    expect(title("1H Spread: Broncos (-2.5)", "Broncos")).toBe("Broncos to win by 3 or more points in the 1st half");
    expect(title("Spread: FC Barcelona (-2.5)", "FC Barcelona", { niche: "soccer" })).toBe("Barcelona to win by 3 or more goals");
    expect(title("Set Handicap: Harold Mayot (-1.5) vs Hugo Grenier (+1.5)", "Hugo Grenier", { niche: "tennis" }, 1)).toBe("Hugo Grenier to win, or lose by 1 or less");
  });

  it("moneylines, periods and set winners", () => {
    expect(title("Colts vs. Texans", "Texans", {}, 1)).toBe("Texans to win");
    expect(title("Ball State vs. Ohio: 1H Moneyline", "Ohio", {}, 1)).toBe("Ohio to win the 1st half");
    expect(title("Set 2 Winner: Alexander Zverev vs Ben Shelton", "Ben Shelton", {}, 1)).toBe("Ben Shelton to win set 2");
    expect(title("Exact Score: Liverpool FC 3 - 1 Manchester United FC?", "No", {}, 1)).toBe("Any final score but Liverpool 3–1 Manchester United");
    expect(title("Denmark vs. Norway: Both Teams to Score", "Yes")).toBe("Denmark vs Norway: both teams to score");
  });

  it("yes/no questions become statements", () => {
    const tech = { category: "tech" as const, market_type: "yes/no" as const, niche: "earnings" };
    expect(title('Will Walmart say "Drone" during earnings call?', "Yes", tech)).toBe('Walmart to say "Drone" during earnings call');
    expect(title('Will Walmart say "Drone" during earnings call?', "No", tech, 1)).toBe('Walmart not to say "Drone" during earnings call');
    expect(title("Will Elon Musk post 340-359 tweets from November 13 to November 20, 2026?", "No", tech, 1))
      .toBe("Elon Musk not to post 340–359 tweets from Nov 13 to Nov 20");
    expect(title("US x Iran Effective Ceasefire by November 22?", "No", tech, 1)).toBe("No US x Iran Effective Ceasefire by Nov 22");
  });

  it("weather", () => {
    const w = { category: "weather" as const, market_type: "multi-outcome" as const, niche: "temperature" };
    expect(title("Will the highest temperature in Munich be 12°C on November 17?", "Yes", w)).toBe("Munich high exactly 12°C on Nov 17");
    expect(title("Will the highest temperature in Munich be 12°C on November 17?", "No", w, 1)).toBe("Munich high not 12°C on Nov 17");
    expect(title("Will the lowest temperature in Miami be between 72-73°F on November 18?", "No", w, 1)).toBe("Miami low outside 72–73°F on Nov 18");
    expect(title("Will the highest temperature in Mexico City be 22°C or higher on November 17?", "No", w, 1)).toBe("Mexico City high under 22°C on Nov 17");
    expect(title("Will it rain in Phoenix, AZ on November 17?", "Yes", w)).toBe("Rain in Phoenix, AZ on Nov 17");
  });

  it("crypto", () => {
    const c = { category: "crypto" as const, market_type: "yes/no" as const, niche: "bitcoin" };
    expect(title("Will the price of Bitcoin be above $64,000 on November 21?", "Yes", c)).toBe("Bitcoin above $64,000 on Nov 21");
    expect(title("Will the price of Bitcoin be above $64,000 on November 21?", "No", c, 1)).toBe("Bitcoin at or below $64,000 on Nov 21");
    expect(title("Will the price of XRP be between $1.00 and $1.10 on November 23?", "No", c, 1)).toBe("XRP outside $1.00–$1.10 on Nov 23");
    expect(title("Will XRP reach $1.10 November 16-22?", "Yes", c)).toBe("XRP to reach $1.10 Nov 16–22");
    expect(title("Gold Up or Down - November 17, 10:15AM-10:30AM ET", "Up", c)).toBe("Gold to go up (Nov 17, 10:15AM-10:30AM ET)");
  });

  it("falls back sensibly on shapes it doesn't know", () => {
    expect(title("Trail Blazers vs. Timberwolves: Odd/Even Score", "Even", {}, 1)).toBe("Trail Blazers vs. Timberwolves: Odd/Even Score: Even");
    expect(title("Will there be 2 earthquakes of 6.5 or above magnitude worldwide?", "No", { category: "other" }, 1)).toBe("Not 2 earthquakes of 6.5 or above magnitude worldwide");
  });

  it("every fixture market, both sides: no raw question, date stamp or question mark, no banned word added", () => {
    for (const m of store.markets) {
      for (const s of m.sides) {
        const t = plainTitle(m, s);
        expect(t, m.question).not.toMatch(/^Will\b|\?$|\d{4}-\d{2}-\d{2}/);
        expect(t.length, m.question).toBeGreaterThan(3);
        if (!bannedHits(m.question).length) expect(bannedHits(t), `${m.question} → ${t}`).toEqual([]);
      }
    }
  });
});

describe("numbers", () => {
  it("winsInTen: one denominator", () => {
    expect(winsInTen(0.68)).toBe("about 7 in 10");
    expect(winsInTen(0.2)).toBe("about 2 in 10");
    expect(winsInTen(0.149)).toBe("about 1 in 10");
    expect(winsInTen(0.04)).toBe("less than 1 in 10");
    expect(winsInTen(0.96)).toBe("more than 9 in 10");
    expect(winsInTen(0.85)).toBe("about 8 in 10");   // #14: halves round down, never above the % shown (95%+ reads "more than 9")
    expect(winsInTen(0.86)).toBe("about 9 in 10");
    expect(winsInTen(0.05)).toBe("about 1 in 10");
  });

  it("$10 wins $X after the fee; the expand line adds the stake back", () => {
    const q = { ask: 0.6, fee: 0.01 };   // 10 / 0.61 = 16.39
    expect(winsLine(q)).toBe("$10 wins $6.39");
    expect(backLine(q)).toBe("If it wins you get $16.39 back ($10 + $6.39)");
    expect(winsLine({ ask: null, fee: null })).toBeNull();
    expect(winsLine({ ask: 0.005, fee: 0 })).toBe("$10 wins $1,990");
  });

  it("stars: 1–3 with a word, null when there's no value after fees", () => {
    expect(stars({ roi_pct: 25, model_neff: 300 })).toEqual({ n: 3, label: "Great value" });
    expect(stars({ roi_pct: 25, model_neff: 40 })).toEqual({ n: 2, label: "Good value" });
    expect(stars({ roi_pct: 12, model_neff: 300 })).toEqual({ n: 2, label: "Good value" });
    expect(stars({ roi_pct: 12, model_neff: 40 })).toEqual({ n: 1, label: "Fair value" });
    expect(stars({ roi_pct: 0.4, model_neff: 300 })).toEqual({ n: 1, label: "Fair value" });
    expect(stars({ roi_pct: -1, model_neff: 300 })).toBeNull();
    expect(stars({ roi_pct: null, model_neff: 300 })).toBeNull();
  });

  it("stars from Free's banded return match Pro's exact one, on every fixture flag", () => {
    for (const m of store.flags) {
      const f = gateMarket(m, "free");
      expect(stars(f.best), m.id).toEqual(stars(m.best));
      if (m.us?.roi_pct != null) expect(stars({ roi_pct: f.us!.roi_pct, model_neff: m.best.model_neff }), m.id).toEqual(stars({ roi_pct: m.us.roi_pct, model_neff: m.best.model_neff }));
    }
  });

  it("sideLabel", () => {
    expect(sideLabel({ outcome: "Under" })).toBe("Bet Under");
    expect(sideLabel({ outcome: "Crystal Palace FC" })).toBe("Bet Crystal Palace");
  });
});

describe("cardVenue (§G1)", () => {
  const base = store.flags.find((m) => m.us)! as StoreMarket;
  const s = base.best as Side;
  it("US twin: the US price, fee, return and link", () => {
    const v = cardVenue(base, s);
    expect(v).toEqual({ kind: "us", url: base.us!.url, ask: base.us!.ask, fee: base.us!.fee, roi_pct: base.us!.roi_pct });
    expect(v.kind === "us" && v.url).toMatch(/^https:\/\/polymarket\.us\//);
  });
  it("us null: international only; us absent (older scan): the international venue as before", () => {
    expect(cardVenue({ ...base, us: null }, s).kind).toBe("intl-only");
    const { us: _u, ...old } = base;
    expect(cardVenue(old, s).kind).toBe("intl");
  });
  it("the US quote prices the best side only", () => {
    const other = base.sides.find((x) => x.side_index !== base.best.side_index)!;
    expect(cardVenue(base, other).kind).toBe("intl-only");
  });
});
