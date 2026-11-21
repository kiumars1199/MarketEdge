// Signed-in user data (docs/03 §3) behind the same Repo interface as LocalRepo. Talks to /api/data,
// which reads and writes Supabase as the user (RLS) with HttpOnly session cookies; no Supabase client here.
import {
  DEFAULT_PROFILE, UniqueViolation,
  type CollectionName, type Collections, type Insert, type Patch, type Profile, type Repo, type Table,
} from "./types";

type Fetch = typeof fetch;
const NAMES: CollectionName[] = ["presets", "dashboards", "watchlist", "alert_rules", "alert_events", "journal"];

/** 403 with { upgrade: true }: the plan's quota is used up (server-enforced). */
export class QuotaExceeded extends Error {
  readonly code = "quota_exceeded";
}

export class SupabaseRepo implements Repo {
  private data = new Map<CollectionName, unknown[]>();
  private profileRow: Profile = DEFAULT_PROFILE;
  private listeners = new Set<() => void>();

  constructor(private base = "/api/data", private fetcher: Fetch = (...a) => fetch(...a)) {}

  /** Load everything once (one request). */
  async load(): Promise<this> {
    const all = (await this.call("GET", "")) as Record<string, unknown> & { profile: Profile };
    for (const n of NAMES) this.data.set(n, (all[n] as unknown[]) ?? []);
    this.profileRow = { ...DEFAULT_PROFILE, ...all.profile };
    this.emit();
    return this;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetcher(this.base + path, {
      method, credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (res.status === 409) throw new UniqueViolation(path.split("/")[1] ?? "row");
    if (res.status === 403 && json?.upgrade) throw new QuotaExceeded(json.error ?? "Plan limit reached");
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    return json;
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };
  private emit() { for (const cb of this.listeners) cb(); }

  snapshot<K extends CollectionName>(name: K): Collections[K][] {
    let v = this.data.get(name);
    if (!v) this.data.set(name, (v = []));
    return v as Collections[K][];
  }
  profileSnapshot(): Profile { return this.profileRow; }

  private set(name: CollectionName, rows: unknown[]) { this.data.set(name, rows); this.emit(); }

  private table<K extends CollectionName>(name: K): Table<Collections[K]> {
    type T = Collections[K];
    const rows = () => this.snapshot(name) as T[];
    return {
      list: async () => rows(),
      get: async (id) => rows().find((r) => r.id === id) ?? null,
      insert: async (input: Insert<T>) => {
        const row = (await this.call("POST", `/${name}`, input)) as T;
        this.set(name, [...rows(), row]);
        return row;
      },
      update: async (id, patch: Patch<T>) => {
        const row = (await this.call("PATCH", `/${name}/${encodeURIComponent(id)}`, patch)) as T | null;
        if (row) this.set(name, rows().map((r) => (r.id === id ? row : r)));
        return row;
      },
      remove: async (id) => {
        await this.call("DELETE", `/${name}/${encodeURIComponent(id)}`);
        if (rows().some((r) => r.id === id)) this.set(name, rows().filter((r) => r.id !== id));
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
    get: async () => this.profileRow,
    patch: async (p: Partial<Profile>) => {
      this.profileRow = (await this.call("PATCH", "/profile", p)) as Profile;
      this.emit();
      return this.profileRow;
    },
  };
}
