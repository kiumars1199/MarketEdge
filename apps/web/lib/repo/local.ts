// Demo-mode user data in localStorage (docs/03 §3). Same Repo interface SupabaseRepo will implement.
import {
  DEFAULT_PROFILE, UniqueViolation,
  type CollectionName, type Collections, type Insert, type Patch, type Profile, type Repo, type Table,
} from "./types";

const PREFIX = "me:v1:";

// Unique constraints from the SQL schema. watchlist treats side_index null as a value (one
// "whole market" row per market), stricter than Postgres NULL semantics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const UNIQUE: Partial<Record<CollectionName, (r: any) => string>> = {
  watchlist: (r) => `${r.market_id}|${r.side_index ?? ""}`,
  alert_events: (r) => r.dedupe_key,
};

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const k = `${PREFIX}__probe`;
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch {
    return null; // SSR, private mode, blocked storage: fall back to memory
  }
}

export class LocalRepo implements Repo {
  private store = storage();
  private memory = new Map<string, unknown>(); // parsed snapshot cache; stable refs for useSyncExternalStore
  private listeners = new Set<() => void>();

  constructor() {
    // other tabs
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key?.startsWith(PREFIX)) { this.memory.delete(e.key); this.emit(); }
      });
    }
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };
  private emit() { for (const cb of this.listeners) cb(); }

  private read<T>(name: string, fallback: T): T {
    const key = PREFIX + name;
    if (this.memory.has(key)) return this.memory.get(key) as T;
    let v = fallback;
    try {
      const raw = this.store?.getItem(key);
      if (raw) v = JSON.parse(raw) as T;
    } catch { /* corrupt or unavailable: use fallback */ }
    this.memory.set(key, v);
    return v;
  }

  private write(name: string, v: unknown) {
    const key = PREFIX + name;
    this.memory.set(key, v);
    try { this.store?.setItem(key, JSON.stringify(v)); } catch { /* quota/unavailable: memory only */ }
    this.emit();
  }

  /** Synchronous snapshot for hooks. Same reference until the collection changes. */
  snapshot<K extends CollectionName>(name: K): Collections[K][] {
    return this.read<Collections[K][]>(name, []);
  }
  profileSnapshot(): Profile {
    const p = this.read<Partial<Profile> | null>("profile", null);
    const key = PREFIX + "profile:merged";
    const cached = this.memory.get(key) as { src: unknown; v: Profile } | undefined;
    if (cached?.src === p) return cached.v;
    const v = { ...DEFAULT_PROFILE, ...p };
    this.memory.set(key, { src: p, v });
    return v;
  }

  private table<K extends CollectionName>(name: K): Table<Collections[K]> {
    type T = Collections[K];
    const uniq = UNIQUE[name];
    const rows = () => this.snapshot(name);
    const clash = (all: T[], row: T) =>
      uniq !== undefined && all.some((r) => r.id !== row.id && uniq(r) === uniq(row));
    return {
      list: async () => rows(),
      get: async (id) => rows().find((r) => r.id === id) ?? null,
      insert: async (input: Insert<T>) => {
        const now = new Date().toISOString();
        const row = {
          id: crypto.randomUUID(), created_at: now,
          ...(name === "presets" ? { updated_at: now } : {}),
          ...(name === "alert_events" ? { fired_at: now } : {}),
          ...input,
        } as unknown as T;
        const all = rows();
        if (clash(all, row)) throw new UniqueViolation(name);
        this.write(name, [...all, row]);
        return row;
      },
      update: async (id, patch: Patch<T>) => {
        const all = rows();
        const i = all.findIndex((r) => r.id === id);
        if (i < 0) return null;
        const row = {
          ...all[i], ...patch, id,
          ...(name === "presets" ? { updated_at: new Date().toISOString() } : {}),
        } as T;
        if (clash(all, row)) throw new UniqueViolation(name);
        this.write(name, all.map((r, j) => (j === i ? row : r)));
        return row;
      },
      remove: async (id) => {
        const all = rows();
        if (all.some((r) => r.id === id)) this.write(name, all.filter((r) => r.id !== id));
      },
    };
  }

  presets = this.table("presets");
  dashboards = this.table("dashboards");
  watchlist = this.table("watchlist");
  alert_rules = this.table("alert_rules");
  alert_events = this.table("alert_events");
  journal = this.table("journal");

  profile = {
    get: async () => this.profileSnapshot(),
    patch: async (p: Partial<Profile>) => {
      this.write("profile", { ...this.read<Partial<Profile> | null>("profile", null), ...p });
      return this.profileSnapshot();
    },
  };
}
