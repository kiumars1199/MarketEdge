// Health report (docs/14 §5): data age, DB reachable, Stripe configured, rate limits. Shared by /api/health
// (public: ok only; details with CRON_SECRET, RT-14) and the admin health view. Never echoes keys, URLs or errors.
// ok = false when there is no data, the DB is configured but unreachable, the scan is older than
// HEALTH_MAX_DATA_AGE_MIN (default 30) on a remote data source, or a live production deploy has no Upstash.
import "server-only";
import { redis } from "@/lib/abuse";
import { DATA_SOURCE, DEMO_MODE } from "@/lib/config";
import { getStore } from "@/lib/data/store";

async function db(): Promise<"ok" | "unreachable" | "not configured"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return "not configured";
  try {
    // Any PostgREST answer below 500 (even "table missing") means Postgres answered.
    const res = await fetch(`${url}/rest/v1/subscriptions?select=user_id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(3_000),
    });
    return res.status < 500 ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function healthReport() {
  const maxAgeMin = Number(process.env.HEALTH_MAX_DATA_AGE_MIN) || 30;
  const [store, dbState] = await Promise.all([getStore().catch(() => undefined), db()]);
  const ageMin = store ? Math.round((Date.now() / 1000 - store.meta.scanned_at) / 60) : null;
  const stale = ageMin === null || ageMin > maxAgeMin;
  // docs/15: without Upstash, limits are per instance (RT-02). Fine in dev and demo; a live production deploy is degraded.
  const ratelimit = redis() ? "on" : "off";
  const rlDown = ratelimit === "off" && process.env.NODE_ENV === "production" && !DEMO_MODE;
  const ok = !!store && dbState !== "unreachable" && !(stale && DATA_SOURCE !== "local") && !rlDown;
  return {
    ok,
    data: store
      ? { scanned_at: store.meta.scanned_at, age_minutes: ageMin, stale, max_age_minutes: maxAgeMin, source: store.source ?? DATA_SOURCE }
      : { error: "no data loaded" },
    db: dbState,
    stripe: process.env.STRIPE_SECRET_KEY ? "configured" : "not configured",
    ratelimit,
  };
}
