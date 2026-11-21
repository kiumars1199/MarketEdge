// Email + password accounts (alongside Google and the email link). Supabase stores and checks the password; we only
// validate its length, rate-limit tries, and gate "set a new password" on a fresh reset email (a marker cookie).
import "@/lib/zod-jitless";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { rateLimit, type Rule } from "@/lib/abuse";
import { COOKIE_OPTIONS } from "./server";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;   // bcrypt reads only the first 72 bytes
export const Password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
export const RESET_PATH = "/reset-password";

export const RESET_COOKIE = "me_reset";
const RESET_TTL_S = 15 * 60;

// The marker is `<user id>.<ms>.<mac>`: signed (HMAC keyed off the service-role key, which only the server holds) and
// bound to the account, so it can't be typed into a borrowed browser's cookie jar or carried to another account.
const proofKey = () => {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return service ? createHmac("sha256", service).update("kismet:reset-proof:v1").digest() : null;
};
const sign = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest("base64url");

/** Set by /auth/callback when a password-reset link (recovery flow) lands on the set-password page. */
export async function markResetProof(userId: string, now = Date.now()) {
  const key = proofKey();
  if (!key) return;
  const body = `${userId}.${now}`;
  (await cookies()).set(RESET_COOKIE, `${body}.${sign(key, body)}`, { ...COOKIE_OPTIONS, maxAge: RESET_TTL_S });
}
/** A reset email for this user was opened in this browser within the last 15 minutes. */
export async function hasResetProof(userId: string, now = Date.now()): Promise<boolean> {
  return validResetProof((await cookies()).get(RESET_COOKIE)?.value, userId, now);
}
export function validResetProof(value: string | undefined, userId: string, now = Date.now()): boolean {
  const key = proofKey();
  const [uid, at, mac] = value?.split(".") ?? [];
  if (!key || !uid || !at || !mac || uid !== userId) return false;
  const want = Buffer.from(sign(key, `${uid}.${at}`)), got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  const t = Number(at);
  return Number.isFinite(t) && t <= now && now - t < RESET_TTL_S * 1000;
}
export async function clearResetProof() {
  (await cookies()).delete(RESET_COOKIE);
}

/** Per-address limit with the magic-link wording: null when allowed, else a 429 saying how long to wait. */
export async function perEmail(rule: Extract<Rule, "auth_email" | "auth_password">, email: string, what: string): Promise<Response | null> {
  const r = await rateLimit(rule, `email:${email.trim().toLowerCase()}`);
  if (!r) return null;
  const after = r.headers.get("Retry-After") || "60";
  const mins = Math.max(1, Math.ceil(Number(after) / 60));
  return Response.json({ error: `Too many ${what} for this email. Try again in ${mins} min.` }, { status: 429, headers: { "Retry-After": after } });
}
