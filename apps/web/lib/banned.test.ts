import { describe, expect, it } from "vitest";
import { bannedHits, readableText } from "./banned";

describe("banned words (docs/OVERHAUL.md §A)", () => {
  it("catches the listed words as whole words", () => {
    for (const t of ["our edge", "the spread", "+4 pts", "the model says", "priced below their record", "per $1 share", "walk-forward test", "+EV bet", "t-stat 2.1"])
      expect(bannedHits(t), t).not.toHaveLength(0);
  });
  it("ignores look-alikes inside other words", () => {
    expect(bannedHits("scripts, events, knowledge, every, spreadsheets, modeler")).toEqual([]);
  });
  it("counts above 3 digits, not times or years", () => {
    expect(bannedHits("1.4K bets", { counts: true })).toHaveLength(1);
    expect(bannedHits("1,117 settled", { counts: true })).toHaveLength(1);
    expect(bannedHits("at 11:53 AM on Nov 21, 2026, 3 steps, 999 bets, Unlock 14 more bets, every 10 minutes", { counts: true })).toHaveLength(0);
    expect(bannedHits("12K bets, 3M users", { counts: true })).toHaveLength(1);
  });
  it("reads title, meta description and visible text, not scripts", () => {
    const html = `<title>Kismet</title><meta name="description" content="no edge here"><script>var model=1</script><p>hi</p>`;
    const t = readableText(html);
    expect(t).toContain("no edge here");
    expect(t).not.toContain("var model");
  });
});
