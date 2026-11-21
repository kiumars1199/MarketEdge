// zod for user rows coming into /api/data (docs/15: every API input parsed, unknown keys rejected,
// numbers bounded). user_id is never accepted from the client: the DB defaults it to auth.uid().
import "@/lib/zod-jitless";
import { z } from "zod";
import type { CollectionName } from "./types";

const id = z.string().uuid();
const ts = z.string().max(40);
const str = (n = 500) => z.string().max(n);
const num = z.number().finite().min(-1e9).max(1e9);
const side = z.union([z.literal(0), z.literal(1)]);
const json = z.unknown();
const meta = { id: id.optional(), created_at: ts.optional() };

export const ROW: Record<CollectionName, z.ZodObject> = {
  presets: z.object({
    ...meta, updated_at: ts.optional(),
    name: str(80), emoji: str(16).nullable(), query: json, columns: z.array(str(40)).max(60).nullable(), sort: json.nullable(),
    is_default: z.boolean(), position: z.number().int().min(0).max(10_000),
  }).strict(),
  dashboards: z.object({
    ...meta, name: str(80), layout: z.array(z.record(z.string(), json)).max(50), position: z.number().int().min(0).max(10_000),
  }).strict(),
  watchlist: z.object({
    ...meta, market_id: str(100), side_index: side.nullable(), note: str(1000).nullable(),
    target_price: z.number().min(0).max(1).nullable(), snapshot: json.nullable(),
  }).strict(),
  alert_rules: z.object({
    ...meta, name: str(80), enabled: z.boolean(),
    kind: z.enum(["preset_match", "market_price", "edge_change", "closing_soon"]),
    query: json.nullable(), market_id: str(100).nullable(), side_index: side.nullable(), threshold: num.nullable(),
    channels: z.array(z.enum(["inapp", "email", "push", "telegram", "discord"])).max(5),
    // docs/15: only Discord / Telegram webhook URLs
    webhook_url: z.string().max(500).regex(/^https:\/\/(discord\.com\/api\/webhooks\/|api\.telegram\.org\/)/).nullable(),
    cooldown_minutes: z.number().int().min(0).max(10_080),
    quiet_hours: z.tuple([z.number().int().min(0).max(24), z.number().int().min(0).max(24)]).nullable(),
    last_fired_at: ts.nullable(),
  }).strict(),
  alert_events: z.object({
    id: z.string().max(40).optional(), fired_at: ts.optional(),
    rule_id: id.nullable(), market_id: str(100), side_index: side.nullable(), payload: json.nullable(),
    sent_channels: z.array(str(20)).max(10), read_at: ts.nullable(), dedupe_key: str(300),
  }).strict(),
  journal: z.object({
    ...meta, market_id: str(100), side_index: side, outcome: str(200).nullable(),
    question: str(500).nullable(), category: str(40).nullable(), niche: str(40).nullable(),
    price: z.number().min(0).max(1), shares: z.number().min(0).max(1e9), fee: z.number().min(0).max(1e6), placed_at: ts,
    model_win_prob: z.number().min(0).max(1).nullable(), model_edge: num.nullable(), closing_price: z.number().min(0).max(1).nullable(),
    result: z.enum(["won", "lost", "void"]).nullable(), settled_at: ts.nullable(), pnl_usd: num.nullable(),
    tags: z.array(str(40)).max(30), note: str(2000).nullable(),
  }).strict(),
};

export const PROFILE_PATCH = z.object({
  display_name: str(80).nullable(), timezone: str(60), bankroll_usd: z.number().min(0).max(1e9).nullable(),
  kelly_fraction: z.number().min(0).max(1), default_stake_usd: z.number().min(0).max(1e9),
  odds_format: z.enum(["cents", "percent", "decimal", "american"]), favorite_topics: z.array(str(60)).max(100),
  onboarded_at: ts.nullable(), density: z.enum(["comfortable", "compact"]), theme: z.enum(["dark", "light"]),
  numbers_mode: z.enum(["simple", "pro"]),
}).partial().strict();

const COLLECTIONS = Object.keys(ROW) as CollectionName[];
export const isCollection = (x: string): x is CollectionName => (COLLECTIONS as string[]).includes(x);
