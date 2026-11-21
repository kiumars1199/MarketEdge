// Site settings from public.app_settings (T-140), read with the service role and cached 60 s per instance.
// app_settings has RLS on and no policies: the browser never reads it, the banner reaches pages via the server.
// Any failure (no DB, demo mode, table missing) = the last good value, else the defaults (today's behavior).
import "server-only";
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import { DEMO_MODE } from "@/lib/config";
import { parseSettings, setSettingsSnapshot, settingsNow, type Settings } from "@/lib/settings-core";

const SETTINGS_TTL_MS = 60_000;
const g = globalThis as { __meSettingsAt?: number; __meSettingsLoad?: Promise<Settings> };

async function load(): Promise<Settings> {
  if (DEMO_MODE || !adminEnabled()) return settingsNow();
  try {
    const { data, error } = await supabaseAdmin().from("app_settings").select("key, value");
    if (error) throw new Error(error.message);
    const s = parseSettings(data as { key: string; value: unknown }[]);
    setSettingsSnapshot(s);
    return s;
  } catch (e) {
    console.error("[settings] read failed, keeping the last value:", (e as Error).message);
    return settingsNow();
  }
}

export async function getSettings(): Promise<Settings> {
  if (g.__meSettingsLoad && Date.now() - (g.__meSettingsAt ?? 0) < SETTINGS_TTL_MS) return g.__meSettingsLoad;
  g.__meSettingsAt = Date.now();
  return (g.__meSettingsLoad = load());
}

/** After an admin write: the next read on this instance goes to the DB (others catch up within the TTL). */
export const bustSettings = () => void (g.__meSettingsLoad = undefined);
