// docs/13 § "What it must handle": every row of the examples table, parse → expected FilterState.
import { describe, expect, it } from "vitest";
import { defaultState, type FilterState } from "@/lib/filters/state";
import { american, describe as line, parse, relax, relaxedNote, removeChip, timeWindow, toFilterState } from "./parse";

// Mon 16 Nov 2026, 18:00 in New York (23:00 UTC). Local midnight is 6 h away.
const NOW = Date.UTC(2026, 10, 16, 23, 0);
const ctx = { now: NOW, tz: "America/New_York", cities: ["New York City", "London", "Seoul (Incheon)", "Paris"] };
const run = (q: string, base: Partial<FilterState> = {}) => {
  const p = parse(q, ctx);
  return { p, f: toFilterState(p, { ...defaultState(), q, ...base }, NOW) };
};

describe("docs/13 examples table", () => {
  it("barcelona 3x good edge → text barcelona · pays ≈ 3x · return ≥ 10%", () => {
    const { p, f } = run("barcelona 3x good edge");
    expect(p.text).toEqual(["barcelona"]);
    expect(f).toMatchObject({ pays_min: 2.61, pays_max: 3.45, roi_min: 10, win_prob_min: 0 });
    expect(line(p)).toBe("Barcelona · Pays ~3x · Return 10%+");
    expect(p.liftsLongShotFloor).toBe(true);
  });

  it("barca 3x → alias barca→barcelona · pays ≈ 3x, no return filter", () => {
    const { p, f } = run("barca 3x");
    expect(p.text).toEqual(["barcelona"]);
    expect(f).toMatchObject({ pays_min: 2.61, pays_max: 3.45 });
    expect(f.roi_min).toBeUndefined();
  });

  it("nfl favorites tomorrow → topic NFL · side favorite · closes tomorrow", () => {
    const { p, f } = run("nfl favorites tomorrow");
    expect(p.text).toEqual([]);
    expect(f).toMatchObject({ topics: ["sports.nfl"], side: "favorite", closes_after_h: 6, closes_within_h: 30 });
  });

  it("over 2.5 goals → text 'over 2.5' · topic soccer", () => {
    const { p, f } = run("over 2.5 goals");
    expect(p.text).toEqual(["over", "2.5"]);
    expect(f.topics).toEqual(["sports.soccer"]);
    expect(f.price_min).toBeUndefined();
  });

  it("nyc weather / highest temp london → topic weather · city", () => {
    const a = run("nyc weather");
    expect(a.p.text).toEqual(["new", "york"]);
    expect(a.f.topics).toEqual(["weather"]);
    expect(line(a.p)).toBe("City: New York · Weather & Climate");
    const b = run("highest temp london");
    expect(b.f.topics).toEqual(["weather"]);
    expect(b.p.text).toContain("london");
    const c = run("london");
    expect(c.f.topics).toEqual(["weather"]);
    expect(run("new york giants").f.topics).toBeUndefined();   // a city inside a team name is not weather
  });

  it("safe bets → chance ≥ 80%", () => {
    const { p, f } = run("safe bets");
    expect(p.text).toEqual([]);
    expect(f.win_prob_min).toBe(0.8);
  });

  it("long shots 5x+ → pays ≥ 5x, long-shot floor lifted", () => {
    const { p, f } = run("long shots 5x+");
    expect(f).toMatchObject({ pays_min: 5, win_prob_min: 0, win_prob_max: 0.4 });
    expect(f.pays_max).toBeUndefined();
    expect(p.liftsLongShotFloor).toBe(true);
  });

  it("lakers +200 → text lakers · pays ≈ 3x (American +200 = 3.0x)", () => {
    const { p, f } = run("lakers +200");
    expect(p.text).toEqual(["lakers"]);
    expect(f).toMatchObject({ pays_min: 2.61, pays_max: 3.45 });
    expect(american("+", 200)).toBe(3);
    expect(american("-", 150)).toBeCloseTo(1.667, 3);
    expect(run("-150").f).toMatchObject({ pays_min: 1.45, pays_max: 1.92 });
  });

  it("bitcoin today → topic bitcoin · closes today", () => {
    const { f } = run("bitcoin today");
    expect(f).toMatchObject({ topics: ["crypto.bitcoin"], closes_within_h: 6 });
    expect(f.closes_after_h).toBeUndefined();
  });

  it("under 40c / below 40¢ → price ≤ 40¢ (floor lifted)", () => {
    for (const q of ["under 40c", "below 40¢", "under 40 cents"]) {
      const { p, f } = run(q);
      expect(p.text).toEqual([]);
      expect(f).toMatchObject({ price_max: 0.4, win_prob_min: 0 });
    }
  });

  it("60% chance / likely → chance ≥ 60% / ≥ 80%", () => {
    expect(run("60% chance").f.win_prob_min).toBe(0.6);
    expect(run("likely").f.win_prob_min).toBe(0.8);
  });

  it("ufc tonight best → topic UFC · closes tonight · sort best return", () => {
    const { f } = run("ufc tonight best");
    expect(f).toMatchObject({ topics: ["sports.ufc"], closes_within_h: 10, sort: { key: "roi", dir: "desc" } });
    expect(f.roi_min).toBeUndefined();
  });

  it("barcelna (typo) → left as text for the fuzzy index", () => {
    expect(run("barcelna").p.text).toEqual(["barcelna"]);
  });

  it("a pasted Polymarket URL → no filters, slug match in the index", () => {
    const { p, f } = run("https://polymarket.com/event/nfl-ind-hou-2026-11-20?tid=1");
    expect(p.text).toEqual([]);
    expect(p.chips.map((c) => c.kind)).toEqual(["link"]);
    expect(f).toEqual({ ...defaultState(), q: "https://polymarket.com/event/nfl-ind-hou-2026-11-20?tid=1" });
  });
});

describe("grammar details", () => {
  it.each([
    ["3x+", [3, Infinity]], ["3x or more", [3, Infinity]], ["under 2x", [1, 2]], ["2-3x", [2, 3]], ["x3", [2.61, 3.45]],
    ["3.5x", [3.05, 4.02]], ["@2.5", [2.17, 2.88]], ["2.5 odds", [2.17, 2.88]],
  ] as [string, [number, number]][])("multiplier %s", (q, r) => {
    expect(parse(q, ctx).pays).toEqual(r);
  });

  it("return words, coin flip, sides, market types, periods, sort words", () => {
    expect(run("+15%").f.roi_min).toBe(15);
    expect(run("15% return").f.roi_min).toBe(15);
    expect(run("great").f).toMatchObject({ roi_min: 20, sort: { key: "roi", dir: "desc" } });
    expect(run("coin flip").f).toMatchObject({ win_prob_min: 0.4, win_prob_max: 0.55 });
    expect(run("underdogs").f.side).toBe("underdog");
    expect(run("nba ml 1h").f).toMatchObject({ topics: ["sports.nba"], market_types: ["moneyline"], periods: ["1H"] });
    expect(run("under 2.5").p.text).toEqual(["under", "2.5"]);   // under + number stays text
    expect(run("safest").f.sort).toEqual({ key: "win_prob", dir: "desc" });
    expect(run("soonest").f.sort).toEqual({ key: "closes", dir: "asc" });
    expect(run("biggest payout").f.sort).toEqual({ key: "pays", dir: "desc" });
    expect(run("live").f.live_only).toBe(true);
    expect(run("in 6 hours").f).toMatchObject({ closes_within_h: 6 });
  });

  it("aliases: man u, psg, spurs by sport, epl, btc, cs2", () => {
    expect(run("man u").p.text).toEqual(["manchester", "united"]);
    expect(run("psg").p.text).toEqual(["paris", "saint-germain"]);
    expect(run("spurs").p.text).toEqual(["tottenham"]);
    expect(run("spurs nba").p.text).toEqual(["san", "antonio"]);
    expect(run("epl").f.topics).toEqual(["sports.soccer.premier-league"]);
    expect(run("btc").f.topics).toEqual(["crypto.bitcoin"]);
    expect(run("cs2").f.topics).toEqual(["sports.esports.counter-strike-2"]);
    expect(run("la liga").f.topics).toEqual(["sports.soccer.la-liga"]);
  });

  it("explicit filters win over typed words; side/sort only replace defaults; topics merge", () => {
    const { f } = run("barcelona 3x nfl favorites best", { pays_min: 5, side: "no", topics: ["weather"], sort: { key: "closes", dir: "asc" } });
    expect(f).toMatchObject({ pays_min: 5, pays_max: 3.45, side: "no", topics: ["weather", "sports.nfl"], sort: { key: "closes", dir: "asc" } });
  });

  it("time windows follow the user's timezone", () => {
    const w = timeWindow("today", NOW, "Europe/London");      // 23:00 in London: 1 h to midnight
    expect((w.to - NOW) / 3_600_000).toBe(1);
    expect(timeWindow("today", NOW, "Not/AZone").to).toBe(Date.UTC(2026, 10, 17));   // unknown zone → UTC
    const we = timeWindow("weekend", NOW, "America/New_York"); // Monday → next Sat 00:00 local
    expect(new Date(we.from).toISOString()).toBe("2026-11-21T05:00:00.000Z");
  });

  it("chips are removable: removeChip cuts the typed words", () => {
    const p = parse("Barcelona 3x good edge", ctx);
    expect(p.chips.map((c) => c.raw)).toEqual(["Barcelona", "3x", "good edge"]);
    expect(removeChip("Barcelona 3x  good edge", p.chips[1]!)).toBe("Barcelona good edge");
  });

  it("relax: drop return → widen pays ±30% → drop time → text only, with an honest note", () => {
    const p = parse("barcelona 3x good edge tomorrow", ctx);
    const r1 = relax(p, "return")!;
    expect(r1.roiMin).toBeUndefined();
    const r2 = relax(r1, "pays")!;
    expect(r2.pays).toEqual([1.83, 4.49]);
    const r3 = relax(r2, "time")!;
    expect(r3.closes).toBeUndefined();
    const r4 = relax(r3, "text")!;
    expect(r4.text).toEqual(["barcelona"]);
    expect(r4.pays).toBeUndefined();
    expect(relax(parse("safe", ctx), "text")).toBeNull();
    expect(relaxedNote(p, r2)).toBe("No bets match all of Barcelona · Pays ~3x · Return 10%+ · Closes tomorrow right now. Showing Barcelona · Pays 1.83–4.49x · Closes tomorrow instead, best first.");
  });
});
