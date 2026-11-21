import { describe, expect, it } from "vitest";
import { ago, basis, chance, closesIn, countdown, edge, exactCount, expectedProfit, formatCount, money, pays, payoutIfWins, payoutMoney, pct, price, realisticReturn, recordLabel, ret, testedLine, usd, utcWhen, winsAbout } from "./format";

describe("docs/18 numbers", () => {
  it("formatCount rounds down, never up", () => {
    // T-288: one decimal at every size (rounded down, trailing ".0" dropped), was "16K" / "12K" / "778K"
    // QA-A (Marc #6): exact below 10,000, no "K"
    expect([999, 1_000, 1_050, 1_099, 1_100, 9_999, 10_000, 999_999].map(formatCount)).toEqual(["999", "1,000", "1,050", "1,099", "1,100", "9,999", "10K", "999.9K"]);
    expect([9_666, 12_340, 16_896, 778_152, 1_240_000, 1_234_567, 1_333_014, 0, 7].map(formatCount)).toEqual(["9,666", "12.3K", "16.8K", "778.1K", "1.2M", "1.2M", "1.3M", "0", "7"]);
    expect([-16_896, 1_000_000_000, 12_345_678_901].map(formatCount)).toEqual(["−16.8K", "1B", "12.3B"]);
    expect([1_000_000, 2_300, 9_999_999, null].map(formatCount)).toEqual(["1M", "2,300", "9.9M", "—"]);
    expect(exactCount(1_333_014)).toBe("1,333,014");
  });
  it("wins about, points and the tested line", () => {
    // T-289 (outside tester): 85% read "9 in 10"; now two tenths when it sits between them. 75% was "8 in 10" (spec changed).
    expect([0.14, 0.1, 0.33, 0.5, 0.75, 0.97, 0].map(winsAbout)).toEqual(["1 in 7", "1 in 10", "1 in 3", "5 in 10", "7–8 in 10", "over 9 in 10", "—"]);
    // the points label moved to lib/betFigures gapPts (won − price); see lib/betFigures.test.ts
    expect(testedLine({ flags: 111, win_rate: 0.0541, roi_pct: -41.85 })).toBe("Bets like this: won 5% of the time, lost money in testing (−42%)");
    expect(testedLine({ flags: 1186, win_rate: 0.14, roi_pct: 6 })).toBe("Bets like this: won 14% of the time, +6% return in testing");
    expect(testedLine({ combos: 2001, win_rate: 0.65, roi_pct: 25.71 }, "3-leg combos")).toBe("3-leg combos: won 65% of the time, +26% return in testing");
    expect([testedLine({ flags: 0 }), testedLine(undefined)]).toEqual([null, null]);
  });
});

describe("format", () => {
  it("formats numbers per docs/06", () => {
    expect([price(0.68), price(0.055), price(null)]).toEqual(["68%", "5.5%", "—"]);
    expect([pct(0.792), ret(33.2), ret(4.62), ret(-2), ret(NaN)]).toEqual(["79%", "+33%", "+4.6%", "−2%", "—"]);
    expect([edge(0.051), edge(-0.02)]).toEqual(["+5.1 pts", "−2.0 pts"]);
    expect([money(2400), money(32.58, true), money(-8, true), money(25)]).toEqual(["$2,400", "+$32.58", "−$8", "$25"]);
    expect(expectedProfit(33, 100)).toBe(33);
    expect([pays(1 / 3), pays(0.5), pays(0.08), pays(0.99), pays(0), pays(null)]).toEqual(["3.0x", "2.0x", "13x", "1.0x", "—", "—"]);
  });
  it("chance labels use the docs/06 bands", () => {
    expect([chance(0.8), chance(0.79), chance(0.55), chance(0.5), chance(0.39), chance(undefined)])
      .toEqual(["Leans your way", "Leans your way", "Leans your way", "Coin flip", "Long shot", null]);
  });
  it("relative times and realistic return", () => {
    const now = 1_000_000_000_000;
    expect([closesIn(now / 1000 + 1800, now), closesIn(now / 1000 + 19 * 3600, now), closesIn(now / 1000 + 72 * 3600, now), closesIn(now / 1000 - 5, now)])
      .toEqual(["30m", "19h", "3 days", "closed"]);
    // T-288: one rounding rule, down (was Math.round: 2h 40m read "3h" on cards and "2h 40m" in the closing strip)
    const at = (min: number) => closesIn(now / 1000 + min * 60, now);
    expect([at(0.2), at(1.9), at(59.9), at(60), at(160), at(119.99), at(47 * 60 + 59), at(48 * 60), at(71 * 60 + 59), at(72 * 60)])
      .toEqual(["1m", "1m", "59m", "1h", "2h", "1h", "47h", "2 days", "2 days", "3 days"]);
    for (let min = 1; min < 48 * 60; min += 7) {
      const c = countdown(now / 1000 + min * 60, now), x = at(min);
      expect(x, `${min} min`).toBe(min < 60 ? c : `${c.split("h")[0]}h`);   // "2h 05m" in the strip ⇔ "2h" on a card
    }
    expect(ago(now / 1000 - 12 * 60, now)).toBe("12 min ago");
    expect(realisticReturn({ realistic_edge: 0.1078, ask: 0.85, fee: 0.0064 })).toBeCloseTo(12.59, 1);
    expect(realisticReturn({ realistic_edge: null, ask: 0.5, fee: 0 })).toBeNull();
  });
});

describe("basis (audit fail 7: counts go through formatCount)", () => {
  it("prints short, rounded-down counts, never the raw number", () => {
    const line = basis({ niche: "nfl", market_type: "moneyline", horizon_h: 24 }, { model_neff: 1313.7, model_events: 9666, model_level: "niche" });
    expect(line).toContain("1,313 eff. samples");
    expect(line).toContain("9,666 events");
    expect(line).not.toMatch(/1313|1314|9666/);
    expect(basis({ niche: "nfl", market_type: "moneyline", horizon_h: 24 }, { model_neff: 42.4, model_events: 57, model_level: "all" })).toContain("42 eff. samples · 57 events");
  });
});

describe("shared helpers merged from page-local copies (CLEANUP.md)", () => {
  it("usd lists a plan price exactly, unlike money()", () => {
    expect([0, 12, 11.99, 99.99, 169.99, 19.5].map(usd)).toEqual(["$0", "$12", "$11.99", "$99.99", "$169.99", "$19.50"]);
    expect(money(169.99)).toBe("$170");
  });
  it("utcWhen shows an ISO time in UTC", () => {
    expect(utcWhen("2026-11-18T15:04:00Z")).toBe("Nov 18, 2026, 3:04 PM UTC");
  });
});

describe("docs/19 P4 card numbers", () => {
  it("payout if it wins = stake / (price + fee), whole dollars from $10", () => {
    expect(payoutIfWins(10, { ask: 0.75, fee: 0.0075 })).toBeCloseTo(13.2, 1);
    expect(payoutMoney(payoutIfWins(10, { ask: 0.75, fee: 0.0075 }))).toBe("$13");
    expect(payoutMoney(payoutIfWins(100, { ask: 0.1, fee: 0 }))).toBe("$1,000");
    expect(payoutMoney(payoutIfWins(5, { ask: 0.9, fee: 0.01 }))).toBe("$5.49");
    expect([payoutIfWins(0, { ask: 0.5, fee: 0 }), payoutIfWins(10, { ask: 0, fee: 0 }), payoutIfWins(10, { ask: 0.99, fee: 0.02 })]).toEqual([null, null, null]);
  });
  it("record label from the sample behind the estimate, never a promise", () => {
    expect([recordLabel(40), recordLabel(99.9), recordLabel(100), recordLabel(2930), recordLabel(undefined)])
      .toEqual(["Thin record", "Thin record", "Strong record", "Strong record", null]);
  });
});

describe("plural (QA-A #6)", () => {
  it("names one thing in the singular and counts through formatCount", async () => {
    const { plural } = await import("./format");
    expect([plural(1, "bet"), plural(0, "bet"), plural(2, "bet"), plural(1_066, "bet"), plural(12_340, "bet")]).toEqual(["1 bet", "0 bets", "2 bets", "1,066 bets", "12.3K bets"]);
    expect(plural(1, "more bet", "more bets")).toBe("1 more bet");
  });
});
