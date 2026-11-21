// T-72: MiniSearch index, q → filters, relevance ranking, honest fallback, pays filter/sort on the fixture.
import { describe, expect, it } from "vitest";
import { marketsPage } from "@/lib/data/respond";
import { getStore } from "@/lib/data/store";
import { CHANCE_BANDS, PAYS_BANDS, apply, paysOf } from "@/lib/filters/apply";
import { betQuote } from "@/lib/betFigures";
import { buildSearch, tokenize } from "@/lib/search/index";
import type { StoreMarket } from "@/lib/types";
import { FilterState, type FilterInput } from "@/lib/filters/state";

const st = (p: FilterInput) => FilterState.parse({ group_by_event: false, page_size: 200, ...p });

describe("search on the fixture", async () => {
  const store = await getStore();
  const text = (r: { market: { question: string; event: string } }) => `${r.market.question} ${r.market.event}`;

  it("typo pass: barcelna → FC Barcelona markets; exact words never fuzz (texans ≠ texas)", () => {
    expect(store.search.find("barcelna")!.has("6673454")).toBe(true);
    expect(store.search.find("bar")!.has("6673454")).toBe(true);
    const texans = [...store.search.find("texans")!.keys()].map((id) => store.byId.get(id)!);
    expect(texans.every((m) => /texans/i.test(m.question + m.event + m.sides.map((s) => s.outcome).join()))).toBe(true);
  });

  it("entities: 'bar' suggests FC Barcelona (and other Barcelona clubs) on the 3rd letter", () => {
    const names = store.search.entities("bar", 5).map((e) => e.name);
    expect(names).toContain("FC Barcelona");
    expect(store.search.entities("lond", 3).map((e) => e.name)).toContain("London");
  });

  it("q merges filters: nyc weather → New York weather only", () => {
    const p = apply(store, st({ q: "nyc weather" }));
    expect(p.total).toBeGreaterThan(0);
    expect(p.rows.every((r) => r.market.category === "weather" && /new york|nyc/i.test(text(r)))).toBe(true);
    expect(p.search!.chips.map((c) => c.label)).toEqual(["City: New York", "Weather & Climate"]);
  });

  it("over 2.5 goals → soccer O/U 2.5 markets", () => {
    const p = apply(store, st({ q: "over 2.5 goals" }));
    expect(p.total).toBeGreaterThan(0);
    expect(p.rows.every((r) => r.market.niche === "soccer" && /2\.5/.test(r.market.question))).toBe(true);
  });

  it("safe bets → every row has a 80%+ chance", () => {
    const p = apply(store, st({ q: "safe bets" }));
    expect(p.total).toBeGreaterThan(0);
    expect(p.rows.every((r) => r.side.win_prob >= 0.8)).toBe(true);
  });

  it("relevance: with text and the default sort, the best text match comes first", () => {
    const p = apply(store, st({ q: "barcelona", win_prob_min: 0 }));
    expect(p.rows.every((r) => /barcelona/i.test(text(r) + r.market.sides.map((s) => s.outcome).join()))).toBe(true);
    expect(/barcelona/i.test(p.rows[0]!.market.question)).toBe(true);
  });

  it("honest fallback: barcelona 3x good edge relaxes and says so; rows are Barcelona, never passed off as 3x", () => {
    const r = marketsPage(store, st({ q: "barcelona 3x good edge" }));
    expect(r.total).toBeGreaterThan(0);
    expect(r.search!.relaxed).toMatch(/^No bets match all of Barcelona · Pays ~3x · Return 10%\+ right now\. Showing /);
    expect(r.rows.every((x) => /barcelona/i.test(text(x)))).toBe(true);
    expect("parsed" in r).toBe(false);
    // an exact hit carries no note
    expect(marketsPage(store, st({ q: "barcelona" })).search!.relaxed).toBeUndefined();
  });

  it("pays filter lifts the long-shot floor; Biggest payout reorders the same set by the after-fee payout (QA-A #68/#69)", () => {
    const p = apply(store, st({ pays_min: 3 }));
    expect(p.total).toBeGreaterThan(0);
    expect(p.rows.every((r) => paysOf(r.side)! >= 3)).toBe(true);
    expect(p.rows.some((r) => r.side.win_prob < 0.4)).toBe(true);
    const s = apply(store, st({ sort: { key: "pays", dir: "desc" } }));
    for (let i = 1; i < s.rows.length; i++) expect(betQuote(s.rows[i - 1]!.market, s.rows[i - 1]!.side).pays!).toBeGreaterThanOrEqual(betQuote(s.rows[i]!.market, s.rows[i]!.side).pays!);
    // every sort shows the same bets, only in another order
    const ids = (q: Parameters<typeof st>[0]) => apply(store, { ...st({ view: "flags", ...q }), page_size: Number.MAX_SAFE_INTEGER }).rows.map((r) => r.market.id + r.side.side_index).sort();
    const base = ids({});
    for (const key of ["pays", "win_prob", "closes", "roi"] as const) expect(ids({ sort: { key, dir: "desc" } })).toEqual(base);
  });

  it("pill counts match what picking the choice shows (pays bands lift the floor; chance/return/closes)", () => {
    const f = apply(store, st({})).facets;
    for (const [k, , lo, hi] of PAYS_BANDS)
      expect([k, f.pays[k]]).toEqual([k, apply(store, st({ pays_min: lo, pays_max: hi === Infinity ? undefined : hi })).total]);
    for (const [k, , lo, hi] of CHANCE_BANDS)
      expect([k, f.chance[k]]).toEqual([k, apply(store, st({ win_prob_min: lo, win_prob_max: hi === 1 ? undefined : hi })).total]);
    expect(f.chance.any).toBe(apply(store, st({})).total);
    expect(f.roi["10"]).toBe(apply(store, st({ roi_min: 10 })).total);
    expect(f.closes_h.reduce((a, b) => a + b, 0)).toBe(apply(store, st({})).total);
  });

  it("search + filter stays fast on the fixture (< 50 ms)", () => {
    const t = performance.now();
    for (const q of ["barcelona 3x good edge", "nyc weather", "bar", "over 2.5 goals"]) marketsPage(store, st({ q }));
    expect((performance.now() - t) / 4).toBeLessThan(50);
  });
});

describe("/api/suggest", async () => {
  const { GET } = await import("@/app/api/suggest/route");
  const get = async (q: string, status = 200) => {
    const res = await GET(new Request(`http://test/api/suggest?${new URLSearchParams({ q })}`));
    expect(res.status).toBe(status);
    return res.json();
  };

  it("'bar' → FC Barcelona among teams; ≤ 9 server rows; interpretation line", async () => {
    const b = await get("bar");
    expect(b.entities.map((e: { name: string }) => e.name)).toContain("FC Barcelona");
    expect(b.entities.length + b.topics.length + b.markets.length).toBeLessThanOrEqual(9);
    const fc = b.entities.find((e: { name: string }) => e.name === "FC Barcelona");
    expect(fc.count).toBeGreaterThan(1);
    expect((await get("barca 3x")).line).toBe("Barcelona · Pays ~3x");
  });

  it("topics by prefix, markets with pays; empty q is empty; q over 120 chars is 400", async () => {
    const w = await get("weat");
    expect(w.topics[0]).toMatchObject({ id: "weather" });
    const n = await get("nyc weather");
    expect(n.markets.length).toBeGreaterThan(0);
    expect(n.markets[0].pays).toBeGreaterThan(1);
    expect(await get("")).toEqual({ q: "", line: "", entities: [], topics: [], markets: [] });
    await get("x".repeat(121), 400);
  });
});

describe("accent-aware search (QA-A #47)", () => {
  const m = (id: string, question: string) => ({ id, question, event: question, sides: [{ outcome: "Yes" }, { outcome: "No" }], tags: [], niche: "other", category: "other", market_type: "binary", derived: {} }) as unknown as StoreMarket;
  const idx = buildSearch([m("1", "Will Bodø/Glimt win the league?"), m("2", "Will The Body top the charts?")], new Map());

  it("spells out letters NFKD keeps whole", () => {
    expect(tokenize("Bodø/Glimt Æsir Straße Łódź")).toEqual(["bodo", "glimt", "aesir", "strasse", "lodz"]);
    expect(tokenize("Atlético Málaga")).toEqual(["atletico", "malaga"]);
  });

  it("'Bodø' and 'bodo' find Bodø/Glimt, never The Body", () => {
    for (const q of ["Bodø", "bodo", "Bodø/Glimt"]) expect([...idx.find(q)!.keys()]).toEqual(["1"]);
    expect([...idx.find("body")!.keys()]).toEqual(["2"]);
  });
});
