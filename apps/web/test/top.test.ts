// T-295: the precomputed top.json (engine/precompute.py, fixture generated from test/fixtures/flags.json) serves the
// landing page and /about exactly as the full store does: same rows, same count, same Free gating and daily sample.
// It falls back to the full store when missing, stale or (Free) too young.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CountsFile, TopFile } from "@/lib/types";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
vi.mock("@/lib/telemetry", () => ({ track: () => {} }));

const { getStoreFor } = await import("@/lib/data/store");
const { getCounts, getResults, getTopStore, pickTop, resetTop, topOrStore, TOP_MAX_AGE_S } = await import("@/lib/data/top");
const { bestBetsCount, bestBetsQuery, bestBetsRows } = await import("@/lib/data/counts");
const { freeView } = await import("@/lib/data/gate");
const { listBody } = await import("@/lib/data/respond");
const { allRows, topByReturn } = await import("@/lib/topBets");

const FIX = path.resolve(import.meta.dirname, "fixtures");
const fixture = <T,>(f: string) => JSON.parse(readFileSync(path.join(FIX, f), "utf8")) as T;
const ids = (rows: { market: { id: string } }[]) => rows.map((r) => r.market.id);

afterEach(() => {
  vi.unstubAllEnvs();
  resetTop();
});

describe("top.json fixture (engine/precompute.py on test/fixtures)", () => {
  it("is a superset of the full store's Best bets rows, in the page's order", async () => {
    const top = fixture<TopFile>("top.json");
    const full = await getStoreFor("pro");
    const want = ids(bestBetsRows(full));
    expect(want.length).toBeGreaterThan(10);
    const have = ids(top.rows);
    for (const id of want) expect(have).toContain(id);
    expect(have.filter((id) => want.includes(id))).toEqual(want);   // same order (flat list, roi desc)
    expect(top.meta.scanned_at).toBe(full.meta.scanned_at);
    for (const r of top.rows) expect(r.side).toEqual(r.market.best);
  });

  it("counts.json matches the full store's counts at scan time", async () => {
    const c = fixture<CountsFile>("counts.json");
    const full = await getStoreFor("pro");
    const n = bestBetsCount(full);
    expect(c.best_bets.total).toBe(n.total);
    expect(c.best_bets.sections).toEqual(n.sections);
    expect(c.markets_scanned).toBe(full.meta.markets_scanned);
    expect(c.flags).toBe(full.flags.length);
    expect(await getCounts()).toEqual(c);
  });

  it("per-category files hold that category's rows", () => {
    const top = fixture<TopFile>("top.json");
    for (const cat of ["sports", "weather"]) {
      const sub = fixture<TopFile>(`top-${cat}.json`);
      expect(ids(sub.rows)).toEqual(ids(top.rows.filter((r) => r.market.category === cat)));
      expect(sub.query.category).toBe(cat);
    }
  });
});

describe("pages built from top.json see what the full store gives them", () => {
  for (const tier of ["free", "pro"] as const) {
    it(`${tier}: Best bets count, page 1 (Free: the daily sample, banded) and /about's top 3 match`, async () => {
      const top = (await getTopStore(tier))!;
      expect(top).toBeDefined();
      expect(top.markets.length).toBeLessThan((await getStoreFor(tier)).markets.length);   // really the small file
      const full = await getStoreFor(tier);
      const [a, b] = tier === "free" ? [freeView(top), freeView(full)] : [top, full];
      expect(bestBetsCount(a)).toEqual(bestBetsCount(b));
      for (const key of ["landing", "u:1", "ip:1.2.3.4"]) {
        const q = bestBetsQuery({ page_size: 3 });
        const x = (await listBody(a, q, tier, key))!, y = (await listBody(b, q, tier, key))!;
        expect(x.total).toBe(y.total);
        expect(x.rows).toEqual(y.rows);   // same rows, same gated numbers
      }
      const about = (s: typeof full) => ids(topByReturn(allRows(s, { view: "flags", verdicts: ["worth it"] }), 3, tier));
      expect(about(top)).toEqual(about(full));
      expect(top.backtest).toEqual(full.backtest);
      expect(top.ledgerSummary).toEqual(full.ledgerSummary);
    });
  }

  it("live tiers can read one category's file", async () => {
    const s = (await getTopStore("pro", "weather"))!;
    expect(new Set(s.flags.map((m) => m.category))).toEqual(new Set(["weather"]));
    expect((await getTopStore("pro", "crypto"))!.flags).toEqual([]);   // no rows: no file, an empty list of the same scan
  });

  it("getResults reads model, backtest and the ledger without the full store", async () => {
    const full = await getStoreFor("pro");
    const r = await getResults();
    expect(r.backtest).toEqual(full.backtest);
    expect(r.model).toEqual(full.model);
    expect(r.meta.rule).toEqual(full.meta.rule);   // /track-record's "How it works" line
  });
});

describe("fallbacks", () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), "top-"));
  const write = (d: string, f: string, at: number) => {
    const top = fixture<TopFile>("top.json");
    writeFileSync(path.join(d, f), JSON.stringify({ ...top, meta: { ...top.meta, scanned_at: at } }));
  };
  const withFiles = (d: string) => {
    for (const f of ["model.json", "backtest.json"]) writeFileSync(path.join(d, f), readFileSync(path.join(FIX, f)));
    vi.stubEnv("DATA_DIR", d);
  };

  it("no top.json: undefined, and topOrStore serves the full store", async () => {
    const d = dir();
    withFiles(d);
    expect(await getTopStore("pro")).toBeUndefined();
    vi.stubEnv("DATA_DIR", FIX);
    resetTop();
    expect(await getTopStore("pro")).toBeDefined();
  });

  it("a top.json over an hour old is ignored (a publisher that stopped writing it)", async () => {
    vi.stubEnv("DATA_CLOCK", "");
    const d = dir();
    withFiles(d);
    write(d, "top.json", Math.floor(Date.now() / 1000) - TOP_MAX_AGE_S - 60);
    expect(await getTopStore("pro")).toBeUndefined();
    resetTop();
    write(d, "top.json", Math.floor(Date.now() / 1000) - 60);
    expect(await getTopStore("pro")).toBeDefined();
  });

  it("Free never gets a scan younger than its delay: the newest old-enough copy, else undefined", async () => {
    vi.stubEnv("DATA_CLOCK", "");
    const now = Math.floor(Date.now() / 1000);
    const d = dir();
    withFiles(d);
    write(d, "top.json", now - 60);                 // 1 min old: too young for the 15-min delay
    expect(await getTopStore("free")).toBeUndefined();
    resetTop();
    write(d, "top-prev.json", now - 10 * 60);       // 10 min: still too young
    write(d, "top-prev2.json", now - 20 * 60);      // 20 min: this one
    expect((await getTopStore("free"))!.meta.scanned_at).toBe(now - 20 * 60);
    expect((await getTopStore("pro"))!.meta.scanned_at).toBe(now - 60);   // live tiers: the newest
  });

  it("pickTop takes the newest copy at or before the cutoff", () => {
    const f = (at: number) => ({ meta: { scanned_at: at } }) as TopFile;
    expect(pickTop([f(10), f(30), f(20)], 25)!.meta.scanned_at).toBe(20);
    expect(pickTop([f(30), undefined], 25)).toBeUndefined();
  });

  it("an unreadable top.json falls back too", async () => {
    const d = dir();
    withFiles(d);
    writeFileSync(path.join(d, "top.json"), "{ not json");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getTopStore("pro")).toBeUndefined();
    vi.stubEnv("DATA_DIR", FIX);
    expect((await topOrStore("pro")).flags.length).toBeGreaterThan(0);
  });
});
