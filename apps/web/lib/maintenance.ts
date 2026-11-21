// Edge-safe read of the maintenance flag for middleware.ts (T-142). No server-only imports.
// Maintenance flag from app_settings with the service role, cached per instance. Admin saves reach the
// Node routes at once (lib/settings.ts) but this edge cache only after MAINT_TTL_MS. Errors keep the last value.
const MAINT_TTL_MS = 30_000;
const maint = { at: 0, on: false };
export async function maintenanceOn(url: string): Promise<boolean> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || Date.now() - maint.at < MAINT_TTL_MS) return maint.on;
  maint.at = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/app_settings?select=value&key=eq.maintenance`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) maint.on = ((await res.json()) as { value: unknown }[])[0]?.value === true;
  } catch { /* keep the last value */ }
  return maint.on;
}
