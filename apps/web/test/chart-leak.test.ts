// Accepted risk RT3-01 (owner-approved Nov 18, AUDIT.md "Accepted risks"): the coarse public curve plus the public price
// lets a signed-out visitor estimate the win chance of flagged bets modelled at "all" / "cat" level a little better than
// Free's 5 pp band. Measured on the LIVE scan in output/ (the committed one), on flagged rows, the rows the attack works
// on: audit run 8 measured a mean error of 1.09–1.13 pp. This test fails if the leak gets worse: mean error < 1.05 pp.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.DATA_DIR = "../../output"; });

const { getStore } = await import("@/lib/data/store");
const { marketBody } = await import("@/lib/data/respond");
const { coarseCurve, curve, publicSegment } = await import("@/lib/data/model");

const ACCEPTED_MEAN_ERR = 0.0105;   // 1.05 pp, owner-approved

const interp = (pts: { price: number; win_prob: number }[], p: number) => {
  if (p <= pts[0]!.price) return pts[0]!.win_prob;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (p <= b.price) return a.win_prob + ((b.win_prob - a.win_prob) * (p - a.price)) / (b.price - a.price);
  }
  return pts.at(-1)!.win_prob;
};

describe("RT3-01 accepted risk: chart leak on live flagged rows", () => {
  it("the attack's mean error stays at or above 1.05 pp", async () => {
    const s = await getStore();
    let n = 0, err = 0;
    for (const exact of s.flags) {
      const body = marketBody(s, exact, "free");   // what Free / signed-out get for this market
      const b = body.market.best;
      if (b.model_level !== "all" && b.model_level !== "cat") continue;
      const segment = b.model_level === "cat" ? `cat:${body.market.category}` : "all";
      expect(publicSegment(segment)).toBe(true);
      const c = curve(s.model, segment, body.market.horizon_h);   // exactly what /api/model/curve sends Free
      const pts = c ? coarseCurve(c).points : null;
      const lo = b.win_prob, w = exact.best.win_prob;
      const clamp = (x: number) => Math.min(Math.max(x, lo), lo + 0.0499);
      n++;
      err += Math.abs(clamp(pts?.length ? interp(pts, b.mid) : b.mid) - w);
    }
    expect(n).toBeGreaterThan(50);
    expect(err / n).toBeGreaterThanOrEqual(ACCEPTED_MEAN_ERR);
  }, 120_000);   // loads the ~20 MB live scan
});
