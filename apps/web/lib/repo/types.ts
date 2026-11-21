// User data rows (docs/03-data-model.md §3). Timestamps are ISO strings. `user_id` is omitted:
// LocalRepo is single-user; SupabaseRepo fills it from the session (RLS).

export type OddsFormat = "cents" | "percent" | "decimal" | "american";
export type Json = unknown;

export interface Profile {
  display_name: string | null;
  timezone: string;
  bankroll_usd: number | null;
  kelly_fraction: number;
  default_stake_usd: number;
  odds_format: OddsFormat;
  favorite_topics: string[];          // taxonomy ids, e.g. "sports.nfl"
  onboarded_at: string | null;
  // display prefs (F-17)
  density: "comfortable" | "compact";
  theme: "dark" | "light";
  numbers_mode: "simple" | "pro";
}

export interface Preset {
  id: string; name: string; emoji: string | null;
  query: Json;                        // FilterState, versioned {"v":1,...}
  columns: string[] | null; sort: Json | null;
  is_default: boolean; position: number;
  created_at: string; updated_at: string;
}

export interface DashboardPanel {
  panel_id: string; kind: string; preset_id?: string; query?: Json;
  x: number; y: number; w: number; h: number; title?: string;
}
export interface Dashboard {
  id: string; name: string; layout: DashboardPanel[]; position: number; created_at: string;
}

export interface WatchlistItem {
  id: string; market_id: string;
  side_index: 0 | 1 | null;           // null = whole market
  note: string | null; target_price: number | null;
  snapshot: Json | null;              // Market row at save time
  created_at: string;
}

export type AlertKind = "preset_match" | "market_price" | "edge_change" | "closing_soon";
export type AlertChannel = "inapp" | "email" | "push" | "telegram" | "discord";
export interface AlertRule {
  id: string; name: string; enabled: boolean; kind: AlertKind;
  query: Json | null; market_id: string | null; side_index: 0 | 1 | null; threshold: number | null;
  channels: AlertChannel[]; webhook_url: string | null;
  cooldown_minutes: number; quiet_hours: [number, number] | null;   // [start_hour, end_hour)
  last_fired_at: string | null; created_at: string;
}

export interface AlertEvent {
  id: string;                         // bigserial in Postgres; uuid locally
  rule_id: string | null; market_id: string; side_index: 0 | 1 | null;
  payload: Json | null; sent_channels: string[];
  fired_at: string; read_at: string | null;
  dedupe_key: string;                 // unique: rule_id|market_id|side|cooldown bucket
}

export interface JournalEntry {
  id: string; market_id: string; side_index: 0 | 1; outcome: string | null;
  question: string | null; category: string | null; niche: string | null;
  price: number; shares: number; fee: number; placed_at: string;
  model_win_prob: number | null; model_edge: number | null;
  closing_price: number | null;
  result: "won" | "lost" | "void" | null; settled_at: string | null;
  pnl_usd: number | null; tags: string[]; note: string | null;
}

export interface Collections {
  presets: Preset;
  dashboards: Dashboard;
  watchlist: WatchlistItem;
  alert_rules: AlertRule;
  alert_events: AlertEvent;
  journal: JournalEntry;
}
export type CollectionName = keyof Collections;

/** Columns the DB defaults; optional on insert. */
type Defaulted = "id" | "created_at" | "updated_at" | "fired_at";
export type Insert<T> = Omit<T, Extract<keyof T, Defaulted>> & Partial<Pick<T, Extract<keyof T, Defaulted>>>;
export type Patch<T> = Partial<Omit<T, "id">>;

/** Thrown on insert/update that breaks a unique constraint (watchlist market+side, alert_events dedupe_key). */
export class UniqueViolation extends Error {
  readonly code = "unique_violation";
  constructor(collection: string) { super(`${collection}: unique constraint violated`); }
}

export interface Table<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  insert(row: Insert<T>): Promise<T>;
  update(id: string, patch: Patch<T>): Promise<T | null>;
  remove(id: string): Promise<void>;
}

export interface Repo {
  presets: Table<Preset>;
  dashboards: Table<Dashboard>;
  watchlist: Table<WatchlistItem>;
  alert_rules: Table<AlertRule>;
  alert_events: Table<AlertEvent>;
  journal: Table<JournalEntry>;
  profile: { get(): Promise<Profile>; patch(p: Partial<Profile>): Promise<Profile> };
  /** Called after any write. Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Cached synchronous reads for useSyncExternalStore: same reference until that data changes. */
  snapshot<K extends CollectionName>(name: K): Collections[K][];
  profileSnapshot(): Profile;
}

export const DEFAULT_PROFILE: Profile = {
  display_name: null, timezone: "America/New_York", bankroll_usd: null,
  kelly_fraction: 0.25, default_stake_usd: 100, odds_format: "percent",
  favorite_topics: [], onboarded_at: null,
  density: "comfortable", theme: "dark", numbers_mode: "simple",
};
