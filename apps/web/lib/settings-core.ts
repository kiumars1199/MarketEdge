// Site settings (T-140): schema, defaults and the last-loaded snapshot. No server-only imports: the tier
// shaping in lib/data/gate.ts reads rowCap()/delayMin() synchronously. lib/settings.ts loads from the DB.
import "@/lib/zod-jitless";
import { z } from "zod";
import { DELAY_MIN, quota, type Tier } from "@/lib/entitlements";

export const SETTINGS = z.object({
  banner_on: z.boolean(),
  banner_text: z.string().trim().max(280),
  maintenance: z.boolean(),
  signups_open: z.boolean(),
  free_rows: z.number().int().min(1).max(200),        // Free rows per request (docs/08 LIMITS)
  free_delay_min: z.number().int().min(0).max(60),     // Free data delay
  trading_allowlist: z.array(z.email().max(254).toLowerCase()).max(200),
  alerts_enabled: z.boolean(),                         // kill switch for the alert cron
}).strict();
export type Settings = z.infer<typeof SETTINGS>;
export type SettingKey = keyof Settings;

/** Today's behavior: a fresh DB, a missing row or a bad value all mean these. */
export const DEFAULT_SETTINGS: Settings = {
  banner_on: false, banner_text: "", maintenance: false, signups_open: true,
  free_rows: quota("free", "rows"), free_delay_min: DELAY_MIN.free,
  trading_allowlist: [], alerts_enabled: true,
};

/** DB rows → settings; each key validated on its own, so one bad row can't change the others. */
export function parseSettings(rows: { key: string; value: unknown }[] | null | undefined): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of Array.isArray(rows) ? rows : []) {
    const field = SETTINGS.shape[r?.key as SettingKey];
    if (!field) continue;
    const p = field.safeParse(r.value);
    if (p.success) (out as Record<string, unknown>)[r.key] = p.data;
  }
  return out;
}

const g = globalThis as { __meSettings?: Settings };
export const settingsNow = (): Settings => g.__meSettings ?? DEFAULT_SETTINGS;
export const setSettingsSnapshot = (s: Settings | undefined) => void (g.__meSettings = s);

/** Rows per request for the tier: Free from settings, paid from the tier table. */
export const rowCap = (tier: Tier): number => (tier === "free" ? settingsNow().free_rows : quota(tier, "rows"));
/** Data delay in minutes for the tier: Free from settings, paid 0. */
export const delayMin = (tier: Tier): number => (tier === "free" ? settingsNow().free_delay_min : DELAY_MIN[tier]);
