import { describe, expect, it } from "vitest";
import fixture from "@/test/fixtures/backtest.json";
import { bucketRows, foldRows, tiles, weekDir, weeksUp } from "./trackRecord";
import type { BacktestFile } from "./types";

const b = fixture as unknown as BacktestFile;
const chosen = b.results[String(b.chosen_half_life_days ?? "None")];

describe("track record tiles", () => {
  it("equal the chosen half-life's taker record in backtest.json", () => {
    const t = Object.fromEntries(tiles(b).map((x) => [x.key, x]));
    const s = chosen.taker;
    expect(t.bets.value).toBe(s.flags);
    expect(t.ret.value).toBe(s.roi_pct);
    expect(t.cents.value).toBe(s.pnl_cents_per_share);
    expect(t.t.value).toBe(s.t_stat);
    expect(t.events.value).toBe(s.events);
    expect([t.bets.text, t.ret.text, t.cents.text, t.t.text, t.events.text]).toEqual(["9,666", "+9.5%", "+7.4 pts", "18.5", "1,394"]);
    expect([t.bets.baseline, t.ret.baseline, t.cents.baseline]).toEqual(["394.4K", "−21%", "−13.4 pts"]);   // T-288: one decimal (was "394K")
  });

  it("keeps empty weeks and losses visible", () => {
    const f = foldRows(b);
    expect(f).toHaveLength((chosen.folds as unknown[]).length);
    expect(f[0]).toMatchObject({ bets: 0, ret: null, retText: "no bets" });
    expect(f.some((x) => x.ret !== null && x.ret < 0)).toBe(true);
  });

  it("buckets show predicted and realized cents", () => {
    expect(bucketRows(b)[0]).toEqual({ bucket: "2–5 pts", bets: 1955, predicted: 3.41, realized: 2.72 });
    expect(bucketRows(b).at(-1)?.bucket).toBe("15+ pts");
  });
});

describe("weeks up (T-288)", () => {
  const withFolds = (folds: { flags: number; roi_pct: number | null }[]) =>
    ({ ...b, results: { [String(b.chosen_half_life_days ?? "None")]: { ...chosen, folds: folds.map((f, i) => ({ ...f, start: 1_700_000_000 + i * 604_800 })) } } }) as unknown as BacktestFile;

  it("counts only weeks whose return is positive as shown: not zero, not break-even, not empty", () => {
    const rows = foldRows(withFolds([
      { flags: 3, roi_pct: 12.5 }, { flags: 2, roi_pct: 0.06 },   // up: "+13%", "+0.1%"
      { flags: 5, roi_pct: 0 }, { flags: 4, roi_pct: 0.04 }, { flags: 4, roi_pct: -0.04 },   // break-even: "+0%"
      { flags: 0, roi_pct: null }, { flags: 1, roi_pct: -3 },   // empty, down
    ]));
    expect(rows.map((r) => r.dir)).toEqual(["up", "up", "flat", "flat", "flat", "none", "down"]);
    expect(weeksUp(rows)).toBe(2);
  });

  it("matches the displayed return", () => {
    for (const x of [0.04, 0.05, 0.049, 0.06, 9.96, 10.4, -0.04, -12]) {
      const shownZero = ["+0%", "−0%"].includes(foldRows(withFolds([{ flags: 1, roi_pct: x }]))[0]!.retText);
      expect(weekDir(x) === "flat", String(x)).toBe(shownZero);
    }
  });

  it("the fixture's count equals its positive-as-shown weeks", () => {
    const rows = foldRows(b);
    expect(weeksUp(rows)).toBe(rows.filter((r) => r.ret !== null && r.ret > 0 && r.retText !== "+0%").length);
  });
});

