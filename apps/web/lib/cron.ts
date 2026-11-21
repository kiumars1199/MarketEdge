// Vercel Cron auth (docs/02): `Authorization: Bearer $CRON_SECRET`, compared in constant time.
// Server only. No secret configured = every request is refused.
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function cronAuthorized(req: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  // Hash both sides so lengths match and timing says nothing about the secret.
  return timingSafeEqual(digest(got), digest(`Bearer ${secret}`));
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
