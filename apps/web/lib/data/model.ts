// Model curve lookup (model.json nodes) and backtest record lookup. Pure; safe to import anywhere.
import type { BacktestFile, BacktestRecord, Market, ModelFile, ModelNode, Side } from "@/lib/types";

/**
 * Segment id of a model node: "all" | "cat:<category>" | "<niche>" | "<niche>:<market_type>".
 * For a market it follows the side's `model_level` (the node its win chance came from).
 */
export function segmentOf(m: Market, s: Side = m.best): string {
  switch (s.model_level) {
    case "nmt": return `${m.niche}:${m.market_type}`;
    case "niche": return m.niche;
    case "cat": return `cat:${m.category}`;
    default: return "all";
  }
}

function findNode(model: ModelFile, segment: string, h: number): ModelNode | undefined {
  const [a, b] = segment.split(":");
  const want =
    segment === "all" ? { level: "all", key: "all", mt: "all" }
    : a === "cat" ? { level: "category", key: b, mt: "all" }
    : b ? { level: "niche+type", key: a, mt: b }
    : { level: "niche", key: a, mt: "all" };
  return model.nodes.find((n) => n.level === want.level && n.key === want.key && n.market_type === want.mt && n.horizon_h === h);
}

export interface Curve {
  segment: string; horizon_h: number; level: ModelNode["level"];
  n: number; neff: number; events: number;
  points: { price: number; win_prob: number }[];   // ascending price; fair line is win_prob = price
}

export function curve(model: ModelFile, segment: string, h: number): Curve | null {
  const node = findNode(model, segment, h);
  if (!node) return null;
  const points = Object.entries(node.win_prob_at_price)
    .map(([p, w]) => ({ price: Number(p), win_prob: w }))
    .sort((x, y) => x.price - y.price);
  return { segment, horizon_h: node.horizon_h, level: node.level, n: node.n, neff: node.neff, events: node.events, points };
}

/** RT3-01 / audit run 6: the curve Free / signed-out callers may see. Rounding to 5 pp alone still let rows modelled at
 *  "all" / "cat" level be un-banded (44 of 98 within 0.5 pp), so the public curve keeps only one point per 10¢ of price,
 *  rounded to 10 pp. A small leak remains and is an accepted risk (AUDIT.md "Accepted risks"); test/chart-leak.test.ts
 *  fails if the attack's mean error on live flagged rows drops below 1.05 pp. */
export function coarseCurve(c: Curve): Curve {
  const at = (x: number) => {
    const p = c.points, k = p.findIndex((q) => q.price >= x);
    if (k <= 0) return (p[k < 0 ? p.length - 1 : 0])?.win_prob ?? x;
    const a = p[k - 1]!, b = p[k]!;
    return a.win_prob + ((b.win_prob - a.win_prob) * (x - a.price)) / (b.price - a.price || 1);
  };
  const points = c.points.length ? Array.from({ length: 10 }, (_, i) => (i * 10 + 5) / 100).map((price) => ({ price, win_prob: Math.round(at(price) * 10) / 10 })) : [];
  return { ...c, points };
}

/** Segments a Free caller may ask /api/model/curve for: the ones /track-record charts publicly ("all", "cat:<category>"). */
export const publicSegment = (segment: string) => segment === "all" || segment.startsWith("cat:");

/** Walk-forward result for the chosen half-life (results are keyed "21" | ... | "None"). */
export const chosenResult = (b: BacktestFile) => b.results[String(b.chosen_half_life_days ?? "None")];

export const categoryRecord = (b: BacktestFile, category: string): BacktestRecord | null =>
  chosenResult(b)?.by_category?.[category] ?? null;
