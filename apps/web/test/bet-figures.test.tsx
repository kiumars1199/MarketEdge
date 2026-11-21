// T-289 (outside tester on production, Nov 20): bet-card labels must match their numbers, one return figure per bet,
// "wins about" rounds right, and the fee is shown. Every surface reads lib/betFigures, so this checks the helper on a
// table of real-shaped sides, then checks that the card, the compact card, the drawer and the MCP text print exactly
// the helper's figures and never a positive label on a side whose edge is not above zero.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiRow, MarketResponse } from "@/lib/api";
import type { Side, StoreMarket } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
}));

const { betFigures, edgeAbove0, gapPts, gapRange, sideChance, sideRecord, verdict } = await import("@/lib/betFigures");
const { winsAbout } = await import("@/lib/format");
const { rangeSide } = await import("@/lib/data/gate");
const { getStore } = await import("@/lib/data/store");
const { sideLines } = await import("@/lib/mcp/server");
const { BetCard } = await import("@/components/market/BetCard");
const { backLine, cardVenue, chanceLine, paysLine, stars } = await import("@/lib/card");
const { MarketCard } = await import("@/components/market/MarketCard");
const { MarketDetail } = await import("@/components/market/MarketDetail");

const side = (x: Partial<Side>): Side => ({
  side_index: 0, outcome: "Yes", ask: 0.7, mid: 0.69, fee: 0.011, win_prob: 0.85, win_prob_low: 0.8,
  edge: 0.139, edge_low: 0.089, roi_pct: 19.55, model_level: "nmt", model_neff: 300, model_events: 120, realistic_edge: 0.08, ...x,
});
const free = (s: Side) => rangeSide(s);

describe("betFigures on real-shaped sides", () => {
  const rows: { name: string; s: Side; stake?: number; want: Partial<{ pts: string; wins: string; tone: string; chance: string | null; record: string | null; ret: string; pays: string; payout: string; feeLine: string }> }[] = [
    // #55/#20: the return shown is the one the win chance gives (roi_pct), not the past-bets figure (realistic_edge)
    { name: "exact, good price, realistic return known", s: side({}),
      want: { pts: "+15 pts", wins: "8–9 in 10", tone: "up", chance: "Leans your way", record: "Strong record", ret: "+20%", pays: "1.41x", payout: "$14.06",
        feeLine: "Pays 1.41x after the fee · Bet $10 → get $14.06 back if it wins" } },
    { name: "won more often than the price, but the fee eats it (edge ≤ 0)", s: side({ ask: 0.8, fee: 0.015, win_prob: 0.81, edge: -0.005, roi_pct: -0.6, realistic_edge: null }),
      want: { pts: "+1 pt", tone: "thin", chance: null, record: null } },
    { name: "priced above the record", s: side({ ask: 0.6, fee: 0.012, win_prob: 0.55, edge: -0.062, roi_pct: -10.1, realistic_edge: null }),
      want: { pts: "−5 pts", tone: "down", chance: null, record: null, ret: "−10%" } },
    { name: "Free band 10–20¢: points from the floored win chance and the band, plus the fee", s: free(side({ win_prob: 0.83, edge: 0.119 })),
      want: { pts: "+11–15 pts", tone: "up", chance: "Leans your way", ret: "+10–20%" } },
    { name: "Free band under 0: no positive labels", s: free(side({ ask: 0.8, fee: 0.015, win_prob: 0.81, edge: -0.005, roi_pct: -0.6, realistic_edge: null })),
      want: { tone: "thin", chance: null, record: null, ret: "under 0%" } },
    { name: "a $250 default stake and a 2¢ fee", s: side({ ask: 0.5, fee: 0.02, win_prob: 0.6, edge: 0.08, roi_pct: 15.4, realistic_edge: null }), stake: 250,
      want: { pays: "1.92x", payout: "$480.77", feeLine: "Pays 1.92x after the fee · Bet $250 → get $480.77 back if it wins", ret: "+15%", wins: "6 in 10" } },
  ];
  for (const { name, s, stake, want } of rows) {
    it(name, () => {
      const f = betFigures(s, { stake });
      const got = { pts: f.pts, wins: f.wins, tone: f.verdict.tone, chance: f.chance, record: f.record, ret: f.ret.text, pays: f.pays, payout: f.payoutText, feeLine: f.feeLine };
      for (const [k, v] of Object.entries(want)) expect(got[k as keyof typeof got], k).toBe(v);
    });
  }

  it("the fee is in the payout: stake ÷ (price + fee), and named in the hover", () => {
    const f = betFigures(side({ ask: 0.5, fee: 0.02 }), { stake: 100 });
    expect(f.payout).toBeCloseTo(100 / 0.52, 6);
    expect(f.feeHelp).toContain("4% of the price");
  });

  it("a live price moves Pays, the payout, the points and the edge together", () => {
    const s = side({ ask: 0.7, fee: 0.011, win_prob: 0.72, edge: 0.009 });
    const f = betFigures(s, { ask: 0.73 });
    expect([f.pays, f.pts, f.verdict.tone, f.chance]).toEqual(["1.35x", "−1 pt", "down", null]);
    expect(f.payout).toBeCloseTo(10 / 0.741, 6);
  });
});

describe("winsAbout rounds to what the % says (docs/19 keeps 'N in 10')", () => {
  it.each([
    [0.85, "8–9 in 10"], [0.8, "8 in 10"], [0.82, "8 in 10"], [0.83, "8–9 in 10"], [0.88, "9 in 10"], [0.9, "9 in 10"],
    [0.925, "over 9 in 10"], [0.95, "over 9 in 10"], [0.99, "over 9 in 10"],
    [0.4, "4 in 10"], [0.45, "4–5 in 10"], [0.49, "5 in 10"], [0.35, "3–4 in 10"], [0.34, "1 in 3"], [0.14, "1 in 7"], [0.05, "1 in 20"],
  ])("%s → %s", (p, want) => expect(winsAbout(p)).toBe(want));
});

describe("on the fixture scan", async () => {
  const store = await getStore();
  const sides = store.markets.flatMap((m) => m.sides);

  it("the Free points band always contains the true gap (won − price)", () => {
    for (const s of sides) {
      const g = gapRange(rangeSide(s))!;
      const gap = s.win_prob - s.ask;
      expect(gap, JSON.stringify(s)).toBeGreaterThanOrEqual(g[0] - 1e-9);
      expect(gap, JSON.stringify(s)).toBeLessThanOrEqual(g[1] + 1e-9);
    }
  });

  it("'Leans your way' and 'Strong record' never sit on a side whose edge is not above zero, exact or banded", () => {
    let checked = 0;
    for (const s of sides.flatMap((x) => [x, rangeSide(x)])) {
      if (edgeAbove0(s)) continue;
      checked++;
      expect(sideChance(s)).toBeNull();
      expect(sideRecord(s)).not.toBe("Strong record");
      expect(verdict(s).tone).not.toBe("up");
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("the points sign agrees with the verdict: 'better price' only with a positive gap", () => {
    for (const s of sides) if (verdict(s).tone === "up") expect(gapPts(s)).toMatch(/^\+/);
  });
});

// T-302: the Best bets card is plain-language (docs/OVERHAUL.md §B): it prints "Wins about N in 10", "$10 wins $X" and
// stars, and its "Why this bet?" carries the return the drawer headlines. Its own figures are checked against
// lib/card.ts; the compact card, the drawer and the MCP text keep the T-289 figures.
describe("card, compact card, drawer and MCP print the same figures", async () => {
  const store = await getStore();
  const flags = store.flags.filter((m) => m.best.realistic_edge != null).slice(0, 3);
  // one exact flag, the same flag as Free sees it, and the losing other side of a flag
  const cases: { m: StoreMarket; s: Side; label: string }[] = [];
  for (const m of flags) {
    cases.push({ m, s: m.best, label: `${m.id} exact` });
    const fm = { ...m, best: rangeSide(m.best), sides: m.sides.map((x) => rangeSide(x)) as StoreMarket["sides"] };
    cases.push({ m: fm, s: fm.best, label: `${m.id} free` });
  }
  const loser = store.flags.find((m) => m.sides.some((x) => x.edge <= 0 && x.side_index !== m.best.side_index))!;
  cases.push({ m: loser, s: loser.sides.find((x) => x.side_index !== loser.best.side_index)!, label: `${loser.id} other side` });
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

  for (const { m, s, label } of cases) {
    it(label, () => {
      const f = betFigures(s, { market: m });
      const r: ApiRow = { market: m, side: s } as ApiRow;
      const body: MarketResponse = { market: m, segment: "", curve: null, backtest: null, event_markets: [] };
      const out = {
        compact: text(renderToStaticMarkup(createElement(MarketCard, { r }))),
        drawer: text(renderToStaticMarkup(createElement(MarketDetail, { id: m.id, side: s.side_index, initial: body }))),
        mcp: sideLines(m, s, Date.now()).join("\n"),
      };
      for (const [where, t] of Object.entries(out)) {
        expect(t, `${where} pays`).toContain(`Pays ${f.pays}`);
        expect(t, `${where} wins`).toContain(`wins about ${f.wins}`);
        expect(t, `${where} pts`).toContain(`(${f.pts})`);
        expect(t, `${where} return`).toContain(f.ret.text);
        expect(t, `${where} payout`).toMatch(new RegExp(`${f.stakeText.replace("$", "\\$")} → (get )?${f.payoutText.replace("$", "\\$")} back`));
        if (!edgeAbove0(s)) {
          expect(t, `${where} chance`).not.toContain("Leans your way");
          expect(t, `${where} record`).not.toContain("Strong record");
          expect(t, `${where} verdict`).not.toMatch(/better price than usual/i);
        }
      }
      expect(out.mcp).toContain(f.feeLine);

      const card = text(renderToStaticMarkup(createElement(BetCard, { r })));
      const v = cardVenue(m, s);
      expect(card, "card chance").toContain(chanceLine(s.win_prob));
      if (paysLine(v)) expect(card, "card pays").toContain(paysLine(v)!);
      if (backLine(v)) expect(card, "why back").toContain(backLine(v)!);
      expect(card, "card return").toContain(`${f.ret.text} est. return`);
      expect(card, "card pays = drawer pays").toContain(`Pays ${f.pays}`);
      const st = stars({ roi_pct: v.roi_pct, model_neff: s.model_neff });
      if (st) expect(renderToStaticMarkup(createElement(BetCard, { r })), "card stars").toContain(st.label);
      if (!edgeAbove0(s)) {
        expect(card, "card stars on a losing side").not.toMatch(/Great value|Good value/);
        expect(card, "card record").not.toContain("Strong record");
      }
    });
  }
});
