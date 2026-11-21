// P5: the Results "By payout" verdicts and the Pays filter note read the backtest honestly.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chosenResult } from "@/lib/data/model";
import { liftsFloor } from "@/lib/filters/apply";
import { FilterState } from "@/lib/filters/state";
import { paysFilterNote, paysRead, paysRows } from "@/lib/trackRecord";
import type { BacktestFile } from "@/lib/types";

describe("payout band verdicts", () => {
  it("calls a result only when |t| >= 2, and never with fewer than 30 bets", () => {
    expect(paysRead(undefined)).toBe("untested");
    expect(paysRead({ flags: 0 })).toBe("untested");
    expect(paysRead({ flags: 12, roi_pct: 40, t_stat: 3 })).toBe("few");
    expect(paysRead({ flags: 267, roi_pct: -2.54, t_stat: -0.29 })).toBe("even");
    expect(paysRead({ flags: 1186, roi_pct: 2.91, t_stat: 0.48 })).toBe("even");
    expect(paysRead({ flags: 3331, roi_pct: 21.2, t_stat: 18.9 })).toBe("won");
    expect(paysRead({ flags: 400, roi_pct: -30, t_stat: -2.4 })).toBe("lost");
    // a big loss that isn't significant is still a loss, never "break-even"
    expect(paysRead({ flags: 111, roi_pct: -41.85, t_stat: -1.7 })).toBe("lost?");
  });
  it("uses the tier that tested more bets in the band", () => {
    const rows = paysRows({ by_pays: {
      best: { "3-5x": { flags: 0 } } as never,
      edge: { "3-5x": { flags: 1186, roi_pct: 2.91, t_stat: 0.48 } } as never,
    } });
    expect(rows.find((x) => x.key === "3-5x")!.main!.flags).toBe(1186);
  });
  it("the filter note says each 2x+ band's tested return, and the losers lost money", () => {
    const note = paysFilterNote({ by_pays: { edge: {
      "2-3x": { flags: 267, roi_pct: -2.54, t_stat: -0.29 }, "3-5x": { flags: 1186, roi_pct: 2.91, t_stat: 0.48 },
      "5-10x": { flags: 605, roi_pct: -0.79, t_stat: -0.07 }, "10x+": { flags: 111, roi_pct: -41.85, t_stat: -1.7 },
    } as never } })!;
    expect(note).toBe("In testing: 2–3x −2.5%, 3–5x +2.9%, 5–10x −0.8%: about break-even. 10x+ −42%: lost money, small sample.");
    expect(paysFilterNote(null)).toBeNull();
  });
  it("matches the shipped backtest without throwing", () => {
    const b = JSON.parse(readFileSync(new URL("../../../output/backtest.json", import.meta.url), "utf8")) as BacktestFile;
    expect(paysRows(chosenResult(b))).toHaveLength(6);
  });
  it("any 2x+ payout lifts the 40% chance floor", () => {
    expect(liftsFloor(FilterState.parse({ pays_min: 2 }))).toBe(true);
    expect(liftsFloor(FilterState.parse({ pays_min: 1.5 }))).toBe(false);
  });
});
