// Server side of paper trading and the extension sign-in (docs/16 §3–4, docs/15 § Trading keys, docs/09 § Auth).
// We never see Kalshi keys. We only issue (1) short-lived extension sign-in tokens and (2) one-time order nonces
// bound to the exact order the user confirmed, which the extension checks with us before it signs anything.
import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { redis } from "@/lib/abuse";
import { getMe, sameOrigin } from "@/lib/auth/server";
import { DEMO_MODE } from "@/lib/config";
import type { Tier } from "@/lib/entitlements";
import { getSettings } from "@/lib/settings";
import { settingsNow } from "@/lib/settings-core";

/** Only "demo" turns trading on. Anything else (unset, "prod") = off: real money waits for docs/16 §5 sign-offs. */
export const tradingEnv = (): "demo" | null => (process.env.KALSHI_TRADING_ENV === "demo" ? "demo" : null);

/** Allow-listed: anyone in demo mode, else emails in TRADING_ALLOWLIST (comma-separated) or the admin
 *  settings allowlist (last-loaded snapshot; currentUser() refreshes it). Trading itself still needs KALSHI_TRADING_ENV. */
export function tradingAllowed(email: string | null): boolean {
  if (DEMO_MODE) return true;
  if (!email) return false;
  const list = (process.env.TRADING_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...list, ...settingsNow().trading_allowlist].includes(email.toLowerCase());
}

/** Signed-in user's email and plan from the Supabase session cookie (tier from the webhook-written subscriptions row). */
export async function currentUser(_req: Request): Promise<{ id: string; email: string; tier: Tier } | null> {
  if (DEMO_MODE) return { id: "demo", email: "demo@localhost", tier: "premium" };
  const [me] = await Promise.all([getMe(), getSettings()]);   // getSettings refreshes the allowlist snapshot
  return me.user?.email ? { id: me.user.id, email: me.user.email, tier: me.tier } : null;
}

/** The extension's ID: NEXT_PUBLIC_EXTENSION_ID (Chrome Web Store ID), else the pinned dev ID in dev and demo mode.
 *  A live production deploy without it = null: no extension origin is trusted (RT-14; the dev key pair is public). */
export const extensionId = (): string | null =>
  process.env.NEXT_PUBLIC_EXTENSION_ID || (process.env.NODE_ENV === "production" && !DEMO_MODE ? null : "cgoaaiaghbckpalppklocajbdpoelmbd");

// On globalThis so every route bundle (and dev hot reloads) in one server process share them.
const g = globalThis as { __meDevSecret?: Buffer; __meUsedNonces?: Map<string, number> };
/** A real deploy never signs with a made-up key, demo mode included (docs/15 § Trading keys). */
export function secret(env: Record<string, string | undefined> = process.env): Buffer | null {
  const s = env.EXT_SIGNING_SECRET;
  if (s && s.length >= 32) return Buffer.from(s);
  if (DEMO_MODE && env.VERCEL_ENV !== "production") return (g.__meDevSecret ??= randomBytes(32)); // per process: one dev server
  return null;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest();

function seal(payload: object): string | null {
  const key = secret();
  if (!key) return null;
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(mac(key, body))}`;
}

function open<T>(token: string): T | null {
  const key = secret();
  const [body, sig] = token.split(".");
  if (!key || !body || !sig) return null;
  const want = mac(key, body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()) as T; } catch { return null; }
}

/** Key-sorted JSON: the same order hashes the same no matter who serialized it. */
export const canonical = (x: unknown): string =>
  Array.isArray(x) ? `[${x.map(canonical).join(",")}]`
  : x && typeof x === "object" ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(x);

const digest = (action: string, payload: unknown) => createHash("sha256").update(`${action}\n${canonical(payload)}`).digest("base64url");

export const NONCE_TTL_MS = 2 * 60_000;
type Nonce = { k: "nonce"; a: string; h: string; exp: number; n: string };

/** One-time nonce for exactly this action + payload, valid 2 minutes. Null when no signing secret is set. */
export const issueNonce = (action: "place" | "cancel", payload: unknown, now = Date.now()) =>
  seal({ k: "nonce", a: action, h: digest(action, payload), exp: now + NONCE_TTL_MS, n: randomBytes(12).toString("base64url") } satisfies Nonce);

// Used nonces: Upstash SET NX (one answer across every instance). Without Upstash (dev, e2e) a per-process Map.
const used = (g.__meUsedNonces ??= new Map<string, number>());
async function firstUse(id: string, exp: number, now: number): Promise<boolean> {
  const r = redis();
  if (r) {
    try { return (await r.set(`me:nonce:${id}`, 1, { nx: true, pxat: exp })) === "OK"; }
    catch (e) { console.error("[trade] nonce store failed, refusing:", (e as Error).message); return false; }   // fail closed
  }
  for (const [k, e] of used) if (e < now) used.delete(k);
  if (used.has(id)) return false;
  used.set(id, exp);
  return true;
}

/** True once per nonce, and only for the same action + payload it was issued for. */
export async function consumeNonce(nonce: string, action: string, payload: unknown, now = Date.now()): Promise<boolean> {
  const n = open<Nonce>(nonce);
  if (!n || n.k !== "nonce" || n.a !== action || n.exp < now || n.h !== digest(action, payload)) return false;
  return firstUse(n.n, n.exp, now);
}

export const EXT_TOKEN_TTL_MS = 30 * 60_000;
/** RT-10: refreshes never stretch one sign-in past this; then the extension signs in again from the site session. */
export const EXT_TOKEN_MAX_AGE_MS = 7 * 24 * 3_600_000;
/** sub = email, uid = Supabase user id, iat0 = when this chain of refreshes first signed in. */
type ExtToken = { k: "ext"; sub: string; uid: string; tier: Tier; exp: number; iat0: number };

/** Short-lived extension sign-in (docs/09 § Auth). The extension refreshes it before it expires. */
export function issueExtToken(user: { id: string; email: string }, tier: Tier, now = Date.now(), iat0 = now) {
  const exp = now + EXT_TOKEN_TTL_MS;
  const token = seal({ k: "ext", sub: user.email, uid: user.id, tier, exp, iat0 } satisfies ExtToken);
  return token ? { token, exp, tier } : null;
}

/** Valid, unexpired and within the absolute lifetime. Tokens from before RT-10 (no uid / iat0) are refused. */
export function verifyExtToken(token: string | null | undefined, now = Date.now()): ExtToken | null {
  const t = token ? open<ExtToken>(token) : null;
  return t && t.k === "ext" && t.exp > now && typeof t.uid === "string" && typeof t.iat0 === "number" &&
    now - t.iat0 <= EXT_TOKEN_MAX_AGE_MS ? t : null;
}

/** CSRF for /api/ext/token: our site (/ext/connect) or our own extension's worker, nothing else. */
export const siteOrExtension = (req: Request) => {
  const id = extensionId();
  return sameOrigin(req) || (!!id && req.headers.get("origin") === `chrome-extension://${id}`);
};
