// Bot and abuse controls for the expensive and paywalled routes (docs/15 § Bots and abuse):
// Vercel BotID, Upstash sliding-window rate limits keyed by user id (else IP + JA4), and an anomaly log for
// accounts pulling more than 5,000 rows an hour. Server only.
import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { checkBotId } from "botid/server";
import { DEMO_MODE } from "@/lib/config";
import { CONNECTOR_PREMIUM_PER_MINUTE, CONNECTOR_PRO_PER_DAY } from "@/lib/connector-plan";

type Window = `${number} ${"s" | "m" | "h" | "d"}`;
export const RULES = {
  markets: { limit: 60, window: "1 m" },     // /api/markets, /api/flags, /api/markets/[id], /api/events/*
  pages: { limit: 50, window: "1 m" },       // list pages past the first, per user (docs/15 pagination cap)
  list_free: { limit: 30, window: "1 m" },   // Free / signed-out list requests (RT-03), on top of markets
  suggest: { limit: 120, window: "1 m" },
  curve: { limit: 60, window: "1 m" },       // /api/model/curve (RT3-01)
  book: { limit: 30, window: "1 m" },
  auth_ip: { limit: 5, window: "1 m" },      // /api/auth/*, per IP
  auth_email: { limit: 5, window: "15 m" },  // emails we send (magic links, password sign-up, reset), per address
  auth_password: { limit: 5, window: "15 m" },  // password sign-in tries, per address (own bucket: guesses can't block the email link)
  checkout: { limit: 10, window: "1 h" },
  admin: { limit: 30, window: "1 m" },       // /api/admin mutations and exports, per admin
  mcp_premium: { limit: CONNECTOR_PREMIUM_PER_MINUTE, window: "1 m" }, // /api/mcp tool calls, Premium, per user (lib/mcp)
  mcp_pro_daily: { limit: CONNECTOR_PRO_PER_DAY, window: "1 d" },// /api/mcp tool calls, Pro: 3 a day, per user (lib/mcp)
  mcp_bad_token: { limit: 30, window: "1 m" },// /api/mcp tokens Supabase rejected, per IP (+JA4): junk can't make us hammer auth
} as const satisfies Record<string, { limit: number; window: Window }>;
export type Rule = keyof typeof RULES;

export const ROWS_PER_HOUR_ALERT = 5_000;
/** Distinct markets a Free / signed-out caller may list per hour (RT-03): 60 full pages of new rows. Browsing never
 *  gets near it; enumerating the ~14k-market scan takes 9+ hours per IP or account. */
export const FREE_ROWS_PER_HOUR = 1_500;

const ms = (w: Window) => {
  const [n, u] = w.split(" ") as [string, "s" | "m" | "h" | "d"];
  return Number(n) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[u];
};

interface Limiter {
  limit(rule: Rule, key: string): Promise<{ ok: boolean; reset: number }>;
  /** Adds n rows to the key's hour; returns the hour's total. */
  rows(key: string, n: number): Promise<number>;
  /** Adds ids to the set at key (kept ttlMs) unless that would grow it past limit: all or nothing. ok + the set's size. */
  distinct(key: string, ids: string[], limit: number, ttlMs: number): Promise<{ ok: boolean; size: number }>;
}

/** Sliding-window log in memory (tests; one instance only). */
export function memoryLimiter(now = () => Date.now()): Limiter {
  const hits = new Map<string, number[]>();
  const rows = new Map<string, number>();
  const sets = new Map<string, { exp: number; ids: Set<string> }>();
  return {
    async limit(rule, key) {
      const { limit, window } = RULES[rule];
      const t = now(), w = ms(window), k = `${rule}:${key}`;
      const list = (hits.get(k) ?? []).filter((x) => x > t - w);
      const ok = list.length < limit;
      if (ok) list.push(t);
      hits.set(k, list);
      return { ok, reset: ok ? t : list[0]! + w };
    },
    async rows(key, n) {
      const k = `${key}:${Math.floor(now() / 3_600_000)}`;
      const total = (rows.get(k) ?? 0) + n;
      rows.set(k, total);
      return total;
    },
    async distinct(key, ids, limit, ttlMs) {
      const t = now();
      if (sets.size > 50_000) for (const [k, v] of sets) if (v.exp < t) sets.delete(k);
      let e = sets.get(key);
      if (!e || e.exp < t) sets.set(key, (e = { exp: t + ttlMs, ids: new Set() }));
      const fresh = [...new Set(ids)].filter((id) => !e.ids.has(id));
      if (e.ids.size + fresh.length > limit) return { ok: false, size: e.ids.size };
      for (const id of fresh) e.ids.add(id);
      return { ok: true, size: e.ids.size };
    },
  };
}

// Same all-or-nothing rule as memoryLimiter().distinct, atomic in Redis.
const DISTINCT_LUA = `local fresh = {}
for i = 3, #ARGV do if redis.call('SISMEMBER', KEYS[1], ARGV[i]) == 0 then table.insert(fresh, ARGV[i]) end end
local size = redis.call('SCARD', KEYS[1])
if size + #fresh > tonumber(ARGV[1]) then return {0, size} end
for _, id in ipairs(fresh) do redis.call('SADD', KEYS[1], id) end
if #fresh > 0 and redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return {1, size + #fresh}`;

function upstashLimiter(redis: Redis): Limiter {
  const limiters = Object.fromEntries(Object.entries(RULES).map(([name, r]) => [name, new Ratelimit({
    redis, limiter: Ratelimit.slidingWindow(r.limit, r.window), prefix: `me:rl:${name}`, analytics: false,
  })])) as Record<Rule, Ratelimit>;
  return {
    async limit(rule, key) {
      const r = await limiters[rule].limit(key);
      return { ok: r.success, reset: r.reset };
    },
    async rows(key, n) {
      const k = `me:rows:${key}:${Math.floor(Date.now() / 3_600_000)}`;
      const total = await redis.incrby(k, n);
      if (total === n) await redis.expire(k, 7_200);
      return total;
    },
    async distinct(key, ids, limit, ttlMs) {
      const [ok, size] = (await redis.eval(DISTINCT_LUA, [`me:set:${key}`], [limit, ttlMs, ...new Set(ids)])) as [number, number];
      return { ok: ok === 1, size };
    },
  };
}

// Dev / demo: no traffic limits, but distinct() budgets (paywall controls, RT-01/RT-03) always count.
const noop: Limiter = { limit: async () => ({ ok: true, reset: 0 }), rows: async () => 0, distinct: (...a) => fallback().distinct(...a) };

/** Upstash client when configured (shared with the trading nonce store). */
export function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

const g = globalThis as { __meLimiter?: Limiter; __meFallback?: Limiter };
/** Per-instance limiter with the same rules: production without Upstash, and any Upstash error (RT-02). */
const fallback = () => (g.__meFallback ??= memoryLimiter());
function limiter(): Limiter {
  if (g.__meLimiter) return g.__meLimiter;
  const r = redis();
  if (r) return (g.__meLimiter = upstashLimiter(r));
  // Demo mode is exempt like /api/health: no accounts, and e2e runs a production build of it on one IP.
  if (process.env.NODE_ENV === "production" && !DEMO_MODE) {
    console.warn("[abuse] UPSTASH_REDIS_REST_URL/TOKEN not set: rate limits are per instance (in memory). Set them in production.");
    return (g.__meLimiter = fallback());
  }
  console.warn("[abuse] UPSTASH_REDIS_REST_URL/TOKEN not set: rate limits are OFF (dev / demo only)");
  return (g.__meLimiter = noop);
}
/** Tests swap in memoryLimiter(); undefined = back to the env choice. */
export const setLimiter = (l: Limiter | undefined) => void (g.__meLimiter = l);

/** Client IP from the platform only (RT-07): on Vercel `x-real-ip` / `x-vercel-forwarded-for`, which the edge sets.
 *  A client-sent `X-Forwarded-For` is never read. Off Vercel there is no trusted proxy: every anonymous caller
 *  shares one key ("local"), so limits stay global rather than per-request. */
export function clientIp(req: Request): string {
  if (!process.env.VERCEL) return "local";
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Rate-limit key: the signed-in user, else the client IP (+ JA4 TLS fingerprint on Vercel). */
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const ja4 = process.env.VERCEL ? req.headers.get("x-vercel-ja4-digest") : null;
  return `ip:${clientIp(req)}${ja4 ? `:${ja4}` : ""}`;
}

export const tooMany = (reset: number) => {
  const secs = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return Response.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429, headers: { "Retry-After": String(secs) } });
};

/** 429 Response when `key` is over `rule`, else null. */
export async function rateLimit(rule: Rule, key: string): Promise<Response | null> {
  try {
    const r = await limiter().limit(rule, key);
    return r.ok ? null : tooMany(r.reset);
  } catch (e) {
    console.error("[abuse] rate limiter unavailable, using the per-instance limiter", e instanceof Error ? e.message : e);
    const r = await fallback().limit(rule, key);   // Upstash outage: same limits per instance, never unlimited
    return r.ok ? null : tooMany(r.reset);
  }
}

/** Distinct-id budget (RT-01 anonymous reveals, RT-03 Free rows): Upstash, else per instance. Never unlimited. */
export async function distinct(key: string, ids: string[], limit: number, ttlMs: number): Promise<{ ok: boolean; size: number }> {
  try {
    return await limiter().distinct(key, ids, limit, ttlMs);
  } catch (e) {
    console.error("[abuse] budget store unavailable, using the per-instance one", e instanceof Error ? e.message : e);
    return fallback().distinct(key, ids, limit, ttlMs);
  }
}

/** RT-03: 429 when these rows would take the caller past FREE_ROWS_PER_HOUR distinct markets this hour, else null. */
export async function rowBudget(req: Request, userId: string | null | undefined, ids: string[]): Promise<Response | null> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const r = await distinct(`rows:${userId ? `u:${userId}` : `ip:${clientIp(req)}`}:${hour}`, ids, FREE_ROWS_PER_HOUR, 3_600_000);
  return r.ok ? null : tooMany((hour + 1) * 3_600_000);
}

/** A search engine or other bot Vercel has verified (BotID `isVerifiedBot`, checked by Vercel, not by user agent).
 *  Owner decision (Nov 18): these skip the market-page limits so search engines can index /m and /event. Off Vercel,
 *  or if the check fails: false (normal limits apply). */
export async function verifiedBot(): Promise<boolean> {
  if (!process.env.VERCEL) return false;
  try {
    return (await checkBotId()).isVerifiedBot === true;
  } catch {
    return false;
  }
}

/** Vercel BotID (docs/15). Pass-through off Vercel (local, CI, e2e). 403 for a detected bot, else null.
 *  The browser side is initBotId() in instrumentation-client.ts; its protect list must name the same routes. */
export async function botCheck(): Promise<Response | null> {
  if (!process.env.VERCEL) return null;
  try {
    const v = await checkBotId();
    return v.isBot && !v.isVerifiedBot ? Response.json({ error: "Automated access is not allowed." }, { status: 403 }) : null;
  } catch (e) {
    console.error("[abuse] BotID check failed", e instanceof Error ? e.message : e);
    return null;   // BotID outage: rate limits still apply
  }
}

/** BotID, then the rate limit: the first answer that refuses wins. */
export async function guard(req: Request, rule: Rule, userId?: string | null): Promise<Response | null> {
  return (await botCheck()) ?? (await rateLimit(rule, clientKey(req, userId)));
}

/** Anomaly log (docs/15): one line when an account (or IP) passes 5,000 rows served in an hour. */
export async function noteRows(req: Request, userId: string | null | undefined, n: number): Promise<void> {
  if (n <= 0) return;
  const key = clientKey(req, userId);
  try {
    const total = await limiter().rows(key, n);
    if (total > ROWS_PER_HOUR_ALERT && total - n <= ROWS_PER_HOUR_ALERT) {
      console.warn(`[anomaly] ${key} pulled ${total} rows this hour (> ${ROWS_PER_HOUR_ALERT})`);
    }
  } catch (e) {
    console.error("[abuse] row count failed", e instanceof Error ? e.message : e);
  }
}
