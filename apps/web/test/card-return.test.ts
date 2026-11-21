// #55/#20 (Mark, Nov 20): the estimated return on every surface is the one the shown win chance gives, so
// win chance × payout − stake (after the fee) equals it; the past-bets figure is a separate, labelled line.
import { describe, expect, it } from "vitest";
import { cardReturn, pastReturnLine } from "@/lib/format";

const s = { ask: 0.7, fee: 0.011, win_prob: 0.85, roi_pct: 19.55, realistic_edge: 0.08, ranges: undefined };

describe("one estimated return", () => {
  it("matches win chance × payout", () => {
    const cost = s.ask + s.fee;
    expect(cardReturn(s).roi).toBeCloseTo(((s.win_prob - cost) / cost) * 100, 1);
    expect(cardReturn(s).text).toBe("+20%");
  });
  it("past bets' return is its own line", () => {
    expect(pastReturnLine(s)).toBe("+11% on average");
    expect(pastReturnLine({ ...s, realistic_edge: null })).toBeNull();
  });
});
