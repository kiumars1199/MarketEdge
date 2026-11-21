// T-42: SupabaseRepo passes the same behaviour tests as LocalRepo (local.test.ts), against an in-memory
// stand-in for /api/data that answers like the real route (rows, 409 on unique violation, 403 on quota).
// The SQL side (constraints, RLS) is covered by test/rls.test.ts.
import { describe, expect, it, vi } from "vitest";
import { QuotaExceeded, SupabaseRepo } from "./supabase";
import { DEFAULT_PROFILE, UniqueViolation } from "./types";

const preset = { name: "NFL edges", emoji: null, query: { v: 1 }, columns: null, sort: null, is_default: false, position: 0 };
const watch = { market_id: "m1", side_index: 0 as const, note: null, target_price: null, snapshot: null };

/** Fake /api/data backed by maps, with the DB's unique keys and a presets quota. */
function fakeApi(presetLimit = Infinity) {
  const tables = new Map<string, Record<string, unknown>[]>();
  let profile: Record<string, unknown> = { ...DEFAULT_PROFILE };
  const uniq: Record<string, (r: Record<string, unknown>) => string> = {
    watchlist: (r) => `${r.market_id}|${r.side_index ?? ""}`,
    alert_events: (r) => String(r.dedupe_key),
  };
  const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status });
  const clash = (name: string, row: Record<string, unknown>) =>
    !!uniq[name] && (tables.get(name) ?? []).some((r) => r.id !== row.id && uniq[name](r) === uniq[name](row));
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const [, name, id] = String(url).replace("/api/data", "").split("/");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const rows = tables.get(name) ?? [];
    if (init?.method === "GET") return json(200, { profile, ...Object.fromEntries(tables) });
    if (name === "profile") { profile = { ...profile, ...body }; return json(200, profile); }
    if (init?.method === "POST") {
      if (name === "presets" && rows.length >= presetLimit) return json(403, { error: "limit", upgrade: true });
      const now = new Date().toISOString();
      const row = { id: crypto.randomUUID(), created_at: now, ...(name === "alert_events" ? { fired_at: now } : {}), ...body };
      if (clash(name, row)) return json(409, { error: "unique_violation" });
      tables.set(name, [...rows, row]);
      return json(200, row);
    }
    if (init?.method === "PATCH") {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return json(200, null);
      const row = { ...rows[i], ...body };
      if (clash(name, row)) return json(409, { error: "unique_violation" });
      tables.set(name, rows.map((r, j) => (j === i ? row : r)));
      return json(200, row);
    }
    tables.set(name, rows.filter((r) => r.id !== id));
    return json(204, null);
  });
  return { fetcher, tables };
}

const make = async (api = fakeApi()) => new SupabaseRepo("/api/data", api.fetcher as unknown as typeof fetch).load();

describe("SupabaseRepo", () => {
  it("CRUD round-trips and reloads from the server", async () => {
    const api = fakeApi();
    const repo = await make(api);
    const p = await repo.presets.insert(preset);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.created_at).toBeTruthy();
    expect(await repo.presets.get(p.id)).toEqual(p);
    const u = await repo.presets.update(p.id, { name: "NBA" });
    expect(u?.name).toBe("NBA");
    expect(await (await make(api)).presets.list()).toHaveLength(1); // reload
    expect(await repo.presets.update("nope", { name: "x" })).toBeNull();
    await repo.presets.remove(p.id);
    expect(await repo.presets.list()).toEqual([]);
  });

  it("watchlist is unique on (market_id, side_index)", async () => {
    const repo = await make();
    await repo.watchlist.insert(watch);
    await expect(repo.watchlist.insert(watch)).rejects.toBeInstanceOf(UniqueViolation);
    const other = await repo.watchlist.insert({ ...watch, side_index: 1 });
    await expect(repo.watchlist.update(other.id, { side_index: 0 })).rejects.toThrow(/unique/);
    await repo.watchlist.insert({ ...watch, side_index: null });
    expect(await repo.watchlist.list()).toHaveLength(3);
  });

  it("alert_events dedupe_key is unique", async () => {
    const repo = await make();
    const ev = { rule_id: "r", market_id: "m", side_index: 0 as const, payload: null, sent_channels: [], read_at: null, dedupe_key: "r|m|0|1" };
    const first = await repo.alert_events.insert(ev);
    expect(first.fired_at).toBeTruthy();
    await expect(repo.alert_events.insert(ev)).rejects.toMatchObject({ code: "unique_violation" });
  });

  it("profile defaults and patch", async () => {
    const api = fakeApi();
    const repo = await make(api);
    expect(await repo.profile.get()).toEqual(DEFAULT_PROFILE);
    await repo.profile.patch({ bankroll_usd: 500, numbers_mode: "pro" });
    const p = await (await make(api)).profile.get();
    expect(p).toMatchObject({ bankroll_usd: 500, numbers_mode: "pro", kelly_fraction: 0.25 });
  });

  it("subscribe fires on writes; snapshots are stable between writes", async () => {
    const repo = await make();
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

  it("a server-side quota refusal surfaces as QuotaExceeded and changes nothing", async () => {
    const repo = await make(fakeApi(1));
    await repo.presets.insert(preset);
    await expect(repo.presets.insert(preset)).rejects.toBeInstanceOf(QuotaExceeded);
    expect(repo.snapshot("presets")).toHaveLength(1);
  });
});
