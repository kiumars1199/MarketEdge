// Who is an admin (T-140, docs/15 § Auth). Pure, no server-only imports, so middleware.ts can use it too.
// The env string is always read on the server and passed in; the browser never decides.

/** ADMIN_EMAILS: comma-separated, trimmed, lowercased. Empty = no admins. */
export const adminEmails = (raw: string | undefined): string[] =>
  (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** RT3-06: with ADMIN_REQUIRE_MFA=true an admin session must be Supabase AAL2 (TOTP verified). Unset = not required.
 *  `aal` comes from supabase.auth.mfa.getAuthenticatorAssuranceLevel() (read from the session JWT, no network). */
export const mfaRequired = (flag: string | undefined) => flag === "true";

/** Admin = signed in through Supabase, email verified, exact (case-insensitive) match. Demo mode never. */
export function isAdminEmail(
  user: { email?: string | null; verified: boolean } | null | undefined,
  raw: string | undefined,
  demo: boolean,
): boolean {
  if (demo || !user?.email || !user.verified) return false;
  return adminEmails(raw).includes(user.email.trim().toLowerCase());
}
