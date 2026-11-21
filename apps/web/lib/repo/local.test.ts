// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRepo } from "./local";
import { DEFAULT_PROFILE, UniqueViolation } from "./types";

const preset = { name: "NFL edges", emoji: null, query: { v: 1 }, columns: null, sort: null, is_default: false, position: 0 };
const watch = { market_id: "m1", side_index: 0 as const, note: null, target_price: null, snapshot: null };

beforeEach(() => localStorage.clear());

describe("LocalRepo", () => {
  it("CRUD round-trips and persists under me:v1:", async () => {
    const repo = new LocalRepo();
    const p = await repo.presets.insert(preset);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.created_at).toBeTruthy();
    expect(await repo.presets.get(p.id)).toEqual(p);
    const u = await repo.presets.update(p.id, { name: "NBA" });
    expect(u?.name).toBe("NBA");
    expect(JSON.parse(localStorage.getItem("me:v1:presets")!)[0].name).toBe("NBA");
    expect(await new LocalRepo().presets.list()).toHaveLength(1); // reload
    expect(await repo.presets.update("nope", { name: "x" })).toBeNull();
    await repo.presets.remove(p.id);
    expect(await repo.presets.list()).toEqual([]);
  });

  it("watchlist is unique on (market_id, side_index)", async () => {
    const repo = new LocalRepo();
    await repo.watchlist.insert(watch);
    await expect(repo.watchlist.insert(watch)).rejects.toBeInstanceOf(UniqueViolation);
    const other = await repo.watchlist.insert({ ...watch, side_index: 1 });
    await expect(repo.watchlist.update(other.id, { side_index: 0 })).rejects.toThrow(/unique/);
    await repo.watchlist.insert({ ...watch, side_index: null });
    expect(await repo.watchlist.list()).toHaveLength(3);
  });

  it("alert_events dedupe_key is unique", async () => {
    const repo = new LocalRepo();
    const ev = { rule_id: "r", market_id: "m", side_index: 0 as const, payload: null, sent_channels: [], read_at: null, dedupe_key: "r|m|0|1" };
    const first = await repo.alert_events.insert(ev);
    expect(first.fired_at).toBeTruthy();
    await expect(repo.alert_events.insert(ev)).rejects.toMatchObject({ code: "unique_violation" });
  });

  it("profile defaults and patch", async () => {
    const repo = new LocalRepo();
    expect(await repo.profile.get()).toEqual(DEFAULT_PROFILE);
    await repo.profile.patch({ bankroll_usd: 500, numbers_mode: "pro" });
    const p = await new LocalRepo().profile.get();
    expect(p).toMatchObject({ bankroll_usd: 500, numbers_mode: "pro", kelly_fraction: 0.25 });
  });

  it("subscribe fires on writes; snapshots are stable between writes", async () => {
    const repo = new LocalRepo();
    const cb = vi.fn();
    const off = repo.subscribe(cb);
    const s1 = repo.snapshot("journal");
    expect(repo.snapshot("journal")).toBe(s1);
    expect(repo.profileSnapshot()).toBe(repo.profileSnapshot());
    await repo.presets.insert(preset);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(repo.snapshot("presets")).toHaveLength(1);
    off();
    await repo.presets.insert(preset);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory when localStorage throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const repo = new LocalRepo();
    await repo.presets.insert(preset);
    expect(await repo.presets.list()).toHaveLength(1);
    spy.mockRestore();
  });
});
