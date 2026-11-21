// The one admin guard (T-140, docs/15 § Auth). Every /admin page, admin API route and admin data read calls
// requireAdmin() first. Non-admins and anonymous visitors get notFound(): a 404, never a 403, so the panel's
// existence isn't revealed. The service-role client is only created after the guard has passed.
import "server-only";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUser, supabaseAdmin, supabaseServer, type SessionUser } from "@/lib/auth/server";
import { DEMO_MODE } from "@/lib/config";
import { isAdminEmail, mfaRequired } from "./core";

/** The signed-in admin, or null. Server-decided (ADMIN_EMAILS is a server-only env). */
export async function adminUser(): Promise<SessionUser | null> {
  if (DEMO_MODE) return null;
  const user = await getUser();
  if (!user || !isAdminEmail(user, process.env.ADMIN_EMAILS, DEMO_MODE)) return null;
  if (!mfaRequired(process.env.ADMIN_REQUIRE_MFA)) return user;
  const { data } = await (await supabaseServer()).auth.mfa.getAuthenticatorAssuranceLevel().catch(() => ({ data: null }));
  return data?.currentLevel === "aal2" ? user : null;   // RT3-06
}

export interface AdminCtx { admin: SessionUser; db: SupabaseClient }

/** Admin + service-role client, or a 404. */
export async function requireAdmin(): Promise<AdminCtx> {
  const admin = await adminUser();
  if (!admin) notFound();
  return { admin, db: supabaseAdmin() };
}

/** Handler for the methods an admin route doesn't support: 404 for anyone else (so Next's automatic 405
 *  doesn't reveal the route exists), 405 for an admin. */
export const adminOnly405 = (allow: string) => async (): Promise<Response> => {
  await requireAdmin();
  return new Response(null, { status: 405, headers: { Allow: allow } });
};

/** Append-only record of an admin mutation (public.admin_audit_log). Throws when it can't be written. */
export async function audit(
  { admin, db }: AdminCtx, action: string, target: string | null, before: unknown = null, after: unknown = null,
): Promise<void> {
  const { error } = await db.from("admin_audit_log").insert({
    actor_id: admin.id, actor_email: admin.email, action, target, before, after,
  });
  if (error) throw new Error(`audit log write failed: ${error.message}`);
}
