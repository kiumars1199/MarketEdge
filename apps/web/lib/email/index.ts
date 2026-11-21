// Transactional email via Resend (docs/14 §5). Server only.
// Magic links do NOT go through here: Supabase Auth sends them over Resend SMTP (docs/setup-notes/ops.md).
// Every optional email carries a one-click unsubscribe (RFC 8058): List-Unsubscribe + List-Unsubscribe-Post headers
// pointing at /api/unsubscribe?t=<signed token>, plus the same link in the body. Required account notices about a
// subscription (T-300: trial ending, receipt, cancel confirmation) have none: see lib/email/lifecycle-templates.ts.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { site } from "@/lib/site";

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || `https://${site.domain}`).replace(/\/+$/, "");

const UNSUB_DAYS = 365;
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const mac = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export interface UnsubClaims { u: string; r?: string; exp: number } // user id, alert rule id (absent = all alert email)

export function unsubscribeToken(userId: string, ruleId?: string, secret = process.env.UNSUBSCRIBE_SECRET, now = Date.now()): string {
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not set");
  const body = b64(JSON.stringify({ u: userId, ...(ruleId ? { r: ruleId } : {}), exp: Math.floor(now / 1000) + UNSUB_DAYS * 86400 }));
  return `${body}.${mac(body, secret)}`;
}

export function verifyUnsubscribe(token: string, secret = process.env.UNSUBSCRIBE_SECRET, now = Date.now()): UnsubClaims | null {
  if (!secret || typeof token !== "string") return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as UnsubClaims;
    if (typeof c.u !== "string" || typeof c.exp !== "number" || c.exp * 1000 < now) return null;
    return c;
  } catch {
    return null;
  }
}

export const unsubscribeUrl = (userId: string, ruleId?: string) =>
  `${siteUrl()}/api/unsubscribe?t=${unsubscribeToken(userId, ruleId)}`;

/** unsubscribeUrl absent = a required transactional notice: no List-Unsubscribe header, no link. */
export interface Email { to: string; subject: string; html: string; text: string; unsubscribeUrl?: string }

/** Sends through Resend; disabled (sent: false) when RESEND_API_KEY or EMAIL_FROM is empty. */
export async function sendEmail(e: Email): Promise<{ sent: boolean; id?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { sent: false };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [e.to], subject: e.subject, html: e.html, text: e.text,
      ...(site.support_email ? { reply_to: site.support_email } : {}),   // replies go to support (config/site.json)
      ...(e.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${e.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // Status only: the response body can echo the recipient address.
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
  return { sent: true, id: ((await res.json()) as { id?: string }).id };
}
