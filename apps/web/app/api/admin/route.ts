// POST /api/admin — every admin mutation (T-141). Order: requireAdmin (404 for anyone else, so the route's
// existence isn't revealed) → same-origin (CSRF) → rate limit → strict zod → write the audit row → act with the service role → a ".done" row. The audit row comes first (RT3-05): if it can't be
// written the action doesn't run (500); a change can never exist without its record. Destructive actions need the target's email typed back; never on your own account.
import { z } from "zod";
import { rateLimit } from "@/lib/abuse";
import { adminOnly405, audit, requireAdmin, type AdminCtx } from "@/lib/admin/server";
import { deleteAccount } from "@/lib/auth/delete";
import { sameOrigin } from "@/lib/auth/server";
import { sendEmail, siteUrl, unsubscribeUrl } from "@/lib/email";
import { signInEmail } from "@/lib/email/templates";
import { readBody } from "@/lib/repo/server";
import { bustSettings, getSettings } from "@/lib/settings";
import { parseSettings, SETTINGS, type SettingKey } from "@/lib/settings-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const other = adminOnly405("POST");
export const GET = other, HEAD = other, PUT = other, PATCH = other, DELETE = other, OPTIONS = other;

const uid = z.uuid();
const confirm = z.string().max(254);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const future = z.iso.datetime({ offset: true }).nullable().refine((d) => d === null || Date.parse(d) > Date.now(), "Expiry must be in the future");
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("comp"), user_id: uid, tier: z.enum(["pro", "premium"]),
    expires_at: future,
  }).strict(),
  // docs/19 P8: grant a plan to an email, account or not (a pending grant is applied when the account is created)
  z.object({ action: z.literal("grant"), email, tier: z.enum(["pro", "premium"]), expires_at: future }).strict(),
  z.object({ action: z.literal("ungrant"), email }).strict(),
  z.object({ action: z.literal("uncomp"), user_id: uid }).strict(),
  z.object({ action: z.literal("revoke_sessions"), user_id: uid, confirm }).strict(),
  z.object({ action: z.literal("delete_user"), user_id: uid, confirm }).strict(),
  z.object({ action: z.literal("send_link"), user_id: uid }).strict(),
  z.object({ action: z.literal("settings"), patch: SETTINGS.partial() }).strict(),
]);
type Body = z.infer<typeof Body>;

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireAdmin();
  if (!sameOrigin(req)) return fail(403, "Bad origin");
  const limited = await rateLimit("admin", `u:${ctx.admin.id}`);
  if (limited) return limited;
  const parsed = Body.safeParse(await readBody(req).catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");
  try {
    return await act(ctx, parsed.data);
  } catch (e) {
    console.error("[admin]", parsed.data.action, (e as Error).message);
    return fail(500, "That didn't work. Check the audit log before retrying.");
  }
}

async function target(ctx: AdminCtx, id: string) {
  const { data } = await ctx.db.auth.admin.getUserById(id);
  return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
}

/** The ".done" row after the change. The intent row already records the action, so a failure here is logged, not
 *  surfaced: the change is applied and on record (append-only table: rows are added, never updated). */
async function done(ctx: AdminCtx, action: string, target: string | null, after: unknown) {
  await audit(ctx, `${action}.done`, target, null, after).catch((e) => console.error("[admin] done row:", (e as Error).message));
}

async function act(ctx: AdminCtx, b: Body): Promise<Response> {
  const { db, admin } = ctx;
  if (b.action === "settings") {
    const keys = Object.keys(b.patch) as SettingKey[];
    if (!keys.length) return fail(400, "Nothing to change");
    // "before" straight from the table, not the 60 s per-instance cache (RT3-05)
    const { data: rows, error: readErr } = await db.from("app_settings").select("key, value").in("key", keys);
    if (readErr) throw new Error(readErr.message);
    const now = parseSettings(rows as { key: string; value: unknown }[]);
    await audit(ctx, "settings.update", keys.join(","), Object.fromEntries(keys.map((k) => [k, now[k]])), b.patch);
    const { error } = await db.from("app_settings").upsert(
      keys.map((key) => ({ key, value: b.patch[key], updated_at: new Date().toISOString(), updated_by: admin.id })),
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    bustSettings();
    await done(ctx, "settings.update", keys.join(","), b.patch);
    return Response.json({ ok: true, settings: await getSettings() });
  }

  if (b.action === "grant" || b.action === "ungrant") {
    const { data: before, error: readErr } = await db.from("plan_grants").select("tier, expires_at, applied_user_id").eq("email", b.email).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (b.action === "ungrant" && !before) return fail(404, "No grant for that email");
    const after = b.action === "grant" ? { tier: b.tier, expires_at: b.expires_at } : null;
    const name = b.action === "grant" ? (before ? "grant.update" : "grant.create") : "grant.revoke";
    await audit(ctx, name, b.email, before ?? null, after);
    const { data, error } = b.action === "grant"
      ? await db.rpc("admin_grant_plan", { e: b.email, t: b.tier, exp: b.expires_at, actor: admin.id })
      : await db.rpc("admin_revoke_grant", { e: b.email });
    if (error) throw new Error(error.message);
    await done(ctx, name, b.email, data ?? null);
    return Response.json({ ok: true, applied: !!(data as { user_id?: string | null } | null)?.user_id });
  }

  const user = await target(ctx, b.user_id);
  if (!user) return fail(404, "No such user");
  const self = user.id === admin.id;
  const typed = "confirm" in b && b.confirm.trim().toLowerCase() === user.email.toLowerCase();

  switch (b.action) {
    case "comp":
    case "uncomp": {
      const { data: before } = await db.from("subscriptions").select("comp_tier, comp_expires_at").eq("user_id", user.id).maybeSingle();
      const after = b.action === "comp" ? { comp_tier: b.tier, comp_expires_at: b.expires_at } : { comp_tier: null, comp_expires_at: null };
      await audit(ctx, `user.${b.action}`, user.email, before ?? null, after);
      const { error } = await db.from("subscriptions").upsert({ user_id: user.id, ...after }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      // removing a comp also ends the email's plan grant (docs/19 P8), so the grants list never shows a stale one
      if (b.action === "uncomp") {
        const { error: gErr } = await db.from("plan_grants").delete().eq("email", user.email.toLowerCase());
        if (gErr) throw new Error(gErr.message);
      }
      await done(ctx, `user.${b.action}`, user.email, after);
      return Response.json({ ok: true });
    }
    case "revoke_sessions": {
      if (self) return fail(400, "Use Sign out everywhere on your own account page instead.");
      if (!typed) return fail(400, "Type the user's email exactly to confirm.");
      await audit(ctx, "user.revoke_sessions", user.email);
      const { data: n, error } = await db.rpc("admin_revoke_sessions", { uid: user.id });
      if (error) throw new Error(error.message);
      await done(ctx, "user.revoke_sessions", user.email, { sessions_revoked: n ?? 0 });
      return Response.json({ ok: true, revoked: n ?? 0 });
    }
    case "delete_user": {
      if (self) return fail(400, "You can't delete your own account from the admin panel.");
      if (!typed) return fail(400, "Type the user's email exactly to confirm.");
      const { data: before } = await db.from("subscriptions").select("tier, status, stripe_customer_id, comp_tier").eq("user_id", user.id).maybeSingle();
      await audit(ctx, "user.delete", user.email, { id: user.id, ...(before ?? {}) }, null);
      const r = await deleteAccount(user.id, false);   // cancels Stripe first, then deletes (rows cascade)
      if (!r.ok) return fail(r.status, r.error);
      await done(ctx, "user.delete", user.email, null);
      return Response.json({ ok: true });
    }
    case "send_link": {
      // The link goes only to the user's inbox; it is never returned to the admin's browser.
      await audit(ctx, "user.send_link", user.email);
      const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email: user.email });
      const hash = data?.properties?.hashed_token;
      if (error || !hash) throw new Error(error?.message ?? "no token");
      const link = `${siteUrl()}/auth/callback?token_hash=${encodeURIComponent(hash)}&type=magiclink`;
      const sent = await sendEmail(signInEmail(user.email, link, unsubscribeUrl(user.id)));
      if (!sent.sent) return fail(503, "Email isn't set up (RESEND_API_KEY and EMAIL_FROM). Nothing was sent.");
      await done(ctx, "user.send_link", user.email, { sent: true });
      return Response.json({ ok: true });
    }
  }
}
