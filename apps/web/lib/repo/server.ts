// /api/data/* handlers: the signed-in user's rows via Supabase with RLS (SupabaseRepo's backend).
// Quotas per tier are enforced here, not only in the UI (docs/08 LIMITS).
import type { SupabaseClient } from "@supabase/supabase-js";
import { authEnabled, getTier, sameOrigin, supabaseServer } from "@/lib/auth/server";
import { readJson } from "@/lib/body";
import { isAppToken } from "@/lib/auth/app-token";
import { can, quota, type QuotaKey } from "@/lib/entitlements";
import { PROFILE_PATCH, ROW, isCollection } from "./schemas";
import { DEFAULT_PROFILE, type CollectionName, type Profile } from "./types";

const MAX_BODY = 256 * 1024;
const err = (status: number, error: string, extra: object = {}) => Response.json({ error, ...extra }, { status });
const QUOTA: Partial<Record<CollectionName, QuotaKey>> = {
  presets: "presets", dashboards: "dashboards", watchlist: "watchlist", alert_rules: "alert_rules",
};

type Ctx = { db: SupabaseClient; userId: string };

/** Signed-in + same-origin (for writes) guard. */
export async function withUser(req: Request, fn: (ctx: Ctx) => Promise<Response>): Promise<Response> {
  if (!authEnabled()) return err(404, "Accounts are off");
  if (req.method !== "GET" && !sameOrigin(req)) return err(403, "Bad origin");
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  if (!data.user || isAppToken((await db.auth.getSession()).data.session?.access_token)) return err(401, "Sign in first");   // T-280
  return fn({ db, userId: data.user.id });
}

/** JSON body, read in chunks up to MAX_BODY (RT-12): undefined when malformed, TOO_LARGE past the cap. */
export const readBody = (req: Request): Promise<unknown> => readJson(req, MAX_BODY);

/** DB row → client row (drop user_id; bigserial ids as strings like LocalRepo's). */
export const out = (r: Record<string, unknown>) => {
  const { user_id: _u, ...rest } = r;
  return typeof rest.id === "number" ? { ...rest, id: String(rest.id) } : rest;
};

const PROFILE_KEYS = Object.keys(DEFAULT_PROFILE) as (keyof Profile)[];
export const profileOut = (r: Record<string, unknown> | null): Profile =>
  ({ ...DEFAULT_PROFILE, ...Object.fromEntries(PROFILE_KEYS.filter((k) => r?.[k] != null).map((k) => [k, r![k]])) }) as Profile;

export async function readAll({ db }: Ctx) {
  const [profile, ...lists] = await Promise.all([
    db.from("profiles").select("*").maybeSingle(),
    ...(["presets", "dashboards", "watchlist", "alert_rules", "alert_events", "journal"] as const).map((t) =>
      db.from(t).select("*").order(t === "alert_events" ? "fired_at" : t === "journal" ? "placed_at" : "created_at")),
  ]);
  const names = ["presets", "dashboards", "watchlist", "alert_rules", "alert_events", "journal"] as const;
  return {
    profile: profileOut(profile.data),
    ...Object.fromEntries(names.map((n, i) => [n, (lists[i].data ?? []).map(out)])),
  };
}

/** Insert one row after validation and the tier's quota. 409 on unique violation (LocalRepo's UniqueViolation). */
export async function insertRow(ctx: Ctx, name: string, body: unknown): Promise<Response> {
  if (!isCollection(name)) return err(404, "Unknown collection");
  const parsed = ROW[name].safeParse(body);
  if (!parsed.success) return err(400, "Invalid row");
  const row: Record<string, unknown> = { ...parsed.data };
  if (name === "alert_events") delete row.id;   // bigserial

  const tier = await getTier();
  if (name === "journal" && !can(tier, "journal")) return err(403, "My bets is part of Pro", { upgrade: true });
  const key = QUOTA[name];
  if (key) {
    const limit = quota(tier, key);
    if (limit !== Infinity) {
      const { count } = await ctx.db.from(name).select("id", { count: "exact", head: true });
      if ((count ?? 0) >= limit) return err(403, `Your plan allows ${limit}`, { upgrade: true, limit });
    }
  }
  // The count above is the fast path; the database trigger (plan_quota, RT-08) is the exact one under races.
  const { data, error } = await ctx.db.from(name).insert(row).select("*").single();
  if (error?.message?.startsWith("plan_quota")) {
    const limit = Number(error.hint) || (key ? quota(tier, key) : 0);
    return err(403, `Your plan allows ${limit}`, { upgrade: true, limit });
  }
  if (error) return error.code === "23505" ? err(409, "unique_violation") : err(400, "Couldn't save");
  return Response.json(out(data));
}

export async function updateRow({ db }: Ctx, name: string, id: string, body: unknown): Promise<Response> {
  if (!isCollection(name)) return err(404, "Unknown collection");
  const parsed = ROW[name].partial().safeParse(body);
  if (!parsed.success) return err(400, "Invalid change");
  const { id: _id, created_at: _c, ...patch } = parsed.data as Record<string, unknown>;
  if (name === "presets") patch.updated_at = new Date().toISOString();
  const { data, error } = await db.from(name).update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return error.code === "23505" ? err(409, "unique_violation") : err(400, "Couldn't save");
  return Response.json(data ? out(data) : null);
}

export async function deleteRow({ db }: Ctx, name: string, id: string): Promise<Response> {
  if (!isCollection(name)) return err(404, "Unknown collection");
  await db.from(name).delete().eq("id", id);
  return new Response(null, { status: 204 });
}

export async function patchProfile({ db, userId }: Ctx, body: unknown): Promise<Response> {
  const parsed = PROFILE_PATCH.safeParse(body);
  if (!parsed.success) return err(400, "Invalid settings");
  const { data, error } = await db.from("profiles").update(parsed.data).eq("user_id", userId).select("*").maybeSingle();
  if (error) return err(400, "Couldn't save");
  return Response.json(profileOut(data));
}

/** First sign-in import of localStorage data (docs/08). Rows that clash or break a quota are skipped. */
export async function importLocal(ctx: Ctx, body: unknown): Promise<Response> {
  if (!body || typeof body !== "object") return err(400, "Invalid import");
  const counts: Record<string, number> = {};
  const { profile, ...cols } = body as Record<string, unknown>;
  if (profile) {
    const p = PROFILE_PATCH.safeParse(profile);
    if (p.success) await ctx.db.from("profiles").update(p.data).eq("user_id", ctx.userId);
  }
  for (const [name, rows] of Object.entries(cols)) {
    if (!isCollection(name) || !Array.isArray(rows)) continue;
    counts[name] = 0;
    for (const r of rows.slice(0, 500)) {
      const res = await insertRow(ctx, name, r);
      if (res.ok) counts[name]++;
    }
  }
  return Response.json({ imported: counts });
}
