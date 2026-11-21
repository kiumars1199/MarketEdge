// #3 (Mark, Nov 20): the live line says why live trails testing when shown win chances ran high.
import { describe, expect, it } from "vitest";
import { calibration } from "@/lib/proof";

describe("calibration sentence", () => {
  it("names the gap when win chances ran 3+ points high", () => {
    expect(calibration({ graded: 742, wins: 574, avg_win_prob: 0.866 })).toBe(
      " Why live trails testing: our win chances have run high, bets we gave 87% won 77% of the time.");
  });
  it("silent when close, too few, or unknown", () => {
    expect(calibration({ graded: 742, wins: 640, avg_win_prob: 0.866 })).toBeNull();
    expect(calibration({ graded: 20, wins: 10, avg_win_prob: 0.9 })).toBeNull();
    expect(calibration({ graded: 742, wins: 574 })).toBeNull();
  });
});
