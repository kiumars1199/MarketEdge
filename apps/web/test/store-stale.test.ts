// QA-A #46/#60 (Marc, Nov 20): a quiet instance served its hour-old copy to the first request (stale-while-revalidate
// had no age limit), and a load landing mid-upload could pair one scan's markets with another scan's flags.
import { mkdtemp, copyFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetStore, getStore, loadRaw, SWR_MAX_MS, WAIT_MS, type RawData } from "@/lib/data/store";

const base = await loadRaw(["local"]);
const at = base.markets.meta.scanned_at;
const scan = (t: number): RawData => ({
  ...base,
  markets: { ...base.markets, meta: { ...base.markets.meta, scanned_at: t } },
  flags: { ...base.flags, meta: { ...base.flags.meta, scanned_at: t } },
});

afterEach(() => { vi.useRealTimers(); _resetStore(); });

describe("getStore stale bound", () => {
  it("a copy refreshed recently is served at once while it reloads", async () => {
    vi.useFakeTimers();
    let next = scan(at);
    _resetStore(async () => next);
    expect((await getStore()).meta.scanned_at).toBe(at);
    next = scan(at + 900);
    vi.advanceTimersByTime(150_000);   // past the 120 s TTL, inside SWR_MAX_MS
    expect((await getStore()).meta.scanned_at).toBe(at);   // old copy now, the new one loads in the background
    await vi.waitFor(async () => expect((await getStore()).meta.scanned_at).toBe(at + 900));
  });

  it("a copy older than SWR_MAX_MS waits for the reload: no hour-old scan after an idle spell", async () => {
    vi.useFakeTimers();
    let next = scan(at);
    _resetStore(async () => next);
    await getStore();
    next = scan(at + 3 * 900);
    vi.advanceTimersByTime(45 * 60_000);
    expect((await getStore()).meta.scanned_at).toBe(at + 3 * 900);
  });

  it("a reload slower than WAIT_MS falls back to the copy in hand", async () => {
    vi.useFakeTimers();
    let slow = false;
    _resetStore(() => (slow ? new Promise<RawData>(() => {}) : Promise.resolve(scan(at))));
    await getStore();
    slow = true;
    vi.advanceTimersByTime(SWR_MAX_MS + 1);
    const p = getStore();
    await vi.advanceTimersByTimeAsync(WAIT_MS + 1);
    expect((await p).meta.scanned_at).toBe(at);
  });

  it("a failed reload falls back to the copy in hand", async () => {
    vi.useFakeTimers();
    let fail = false;
    _resetStore(async () => { if (fail) throw new Error("down"); return scan(at); });
    await getStore();
    fail = true;
    vi.advanceTimersByTime(SWR_MAX_MS + 1);
    expect((await getStore()).meta.scanned_at).toBe(at);
  });

  it("never steps back to an older scan", async () => {
    vi.useFakeTimers();
    let next = scan(at + 900);
    _resetStore(async () => next);
    await getStore();
    next = scan(at);
    vi.advanceTimersByTime(SWR_MAX_MS + 1);
    expect((await getStore()).meta.scanned_at).toBe(at + 900);
  });
});

describe("loadRaw torn upload", () => {
  it("refuses markets and flags from different scans", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "torn-"));
    const src = path.resolve(process.cwd(), process.env.DATA_DIR || "../../output");
    for (const f of ["markets.json", "model.json", "backtest.json"]) await copyFile(path.join(src, f), path.join(d, f));
    const flags = JSON.parse(await readFile(path.join(src, "flags.json"), "utf8"));
    flags.meta.scanned_at += 900;
    await writeFile(path.join(d, "flags.json"), JSON.stringify(flags));
    const old = process.env.DATA_DIR;
    process.env.DATA_DIR = d;
    try {
      await expect(loadRaw(["local"])).rejects.toThrow(/torn load/);
    } finally {
      if (old === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = old;
    }
  });
});
