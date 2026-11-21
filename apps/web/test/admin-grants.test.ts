// docs/19 P8: plan grants by email (pending until the account exists), every change audited first, and the owner's
// ADMIN_EMAILS address is an admin after sign-in. The SQL runs the real migrations in PGlite (as test/rls.test.ts).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { effectiveTier } from "@/lib/entitlements";

const MIG = path.resolve(__dirname, "../../../supabase/migrations");
const ADMIN = "00000000-0000-0000-0000-0000000000ad";
const OLD = "00000000-0000-0000-0000-000000000001";
const NEW = "00000000-0000-0000-0000-000000000002";
const LATE = "00000000-0000-0000-0000-000000000003";

const AUTH_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
  created_at timestamptz default now(), last_sign_in_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade, created_at timestamptz default now(),
  updated_at timestamptz, refreshed_at timestamp, oauth_client_id uuid);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated, service_role;
`;

describe("plan grants (supabase/migrations)", () => {
  let db: PGlite;
  const sub = async (id: string) =>
    (await db.query<{ tier: string; comp_tier: string | null; comp_expires_at: string | null }>(
      "select tier, comp_tier, comp_expires_at from subscriptions where user_id = $1", [id])).rows[0];
  const grant = (e: string, t: string, exp: string | null) =>
    db.query<{ r: { user_id: string | null } }>("select admin_grant_plan($1, $2, $3, $4) as r", [e, t, exp, ADMIN]);

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(AUTH_STUB);
    for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(MIG, f), "utf8"));
    await db.exec(`grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;`);
    await db.exec(`insert into auth.users (id, email) values ('${OLD}', 'Old@Example.com')`);
  }, 60_000);

  it("an existing account gets the grant at once (case-insensitive email)", async () => {
    const { rows } = await grant("  OLD@example.com ", "premium", null);
    expect(rows[0].r.user_id).toBe(OLD);
    expect(effectiveTier(await sub(OLD))).toBe("premium");
    const g = (await db.query<{ email: string; applied_user_id: string }>("select email, applied_user_id from plan_grants")).rows;
    expect(g).toEqual([{ email: "old@example.com", applied_user_id: OLD }]);
  });

  it("a pending grant is applied when the account is created (first sign-in)", async () => {
    const until = new Date(Date.now() + 30 * 864e5).toISOString();
    expect((await grant("new@example.com", "pro", until)).rows[0].r.user_id).toBeNull();
    await db.exec(`insert into auth.users (id, email) values ('${NEW}', 'New@example.com')`);
    const s = await sub(NEW);
    expect(s.tier).toBe("free");
    expect(s.comp_tier).toBe("pro");
    expect(effectiveTier(s)).toBe("pro");
    expect((await db.query("select 1 from plan_grants where email = 'new@example.com' and applied_user_id = $1", [NEW])).rows).toHaveLength(1);
  });

  it("an expired pending grant is not applied", async () => {
    await db.exec(`insert into plan_grants (email, tier, expires_at, created_by, updated_by)
      values ('late@example.com', 'premium', now() - interval '1 day', '${ADMIN}', '${ADMIN}')`);
    await db.exec(`insert into auth.users (id, email) values ('${LATE}', 'late@example.com')`);
    expect(await sub(LATE)).toMatchObject({ tier: "free", comp_tier: null });
  });

  it("edit changes tier and expiry; revoke deletes the grant and the comp, never the paid tier", async () => {
    await db.exec(`update subscriptions set tier = 'pro' where user_id = '${OLD}'`);
    await grant("old@example.com", "pro", "2099-01-01T00:00:00Z");
    expect(await sub(OLD)).toMatchObject({ tier: "pro", comp_tier: "pro" });
    const { rows } = await db.query<{ r: { removed: boolean } }>("select admin_revoke_grant('old@example.com') as r");
    expect(rows[0].r.removed).toBe(true);
    expect(await sub(OLD)).toMatchObject({ tier: "pro", comp_tier: null, comp_expires_at: null });
    expect((await db.query("select 1 from plan_grants where email = 'old@example.com'")).rows).toEqual([]);
  });

  it("users and anon can't read grants or call the grant functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${NEW}', false);`);
      try {
        expect((await db.query("select * from plan_grants")).rows).toEqual([]);
        await expect(db.query("select admin_grant_plan('x@example.com', 'premium', null, $1)", [NEW])).rejects.toThrow(/permission denied/);
        await expect(db.query("select admin_revoke_grant('new@example.com')")).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role;");
      }
    }
  });
});

// ---------------------------------------------------------------- POST /api/admin grant / ungrant
const owner = { id: "00000000-0000-4000-8000-000000000001", email: "kismetodds@gmail.com", verified: true };
type Op = [string, string, unknown?];
function fakeDb({ auditFails = false, existing = null as object | null } = {}) {
  const ops: Op[] = [];
  const db = {
    from: (table: string) => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: existing, error: null }),
        insert: async (row: unknown) => {
          ops.push([table, "insert", row]);
          return { error: table === "admin_audit_log" && auditFails ? { message: "down" } : null };
        },
      };
      return q;
    },
    rpc: async (name: string, args: unknown) => { ops.push([name, "rpc", args]); return { data: { user_id: null }, error: null }; },
  };
  return { db, ops };
}
async function post(db: object, body: object) {
  vi.doMock("@/lib/admin/server", async (orig) => ({ ...(await orig<object>()), requireAdmin: async () => ({ admin: owner, db }) }));
  vi.doMock("@/lib/abuse", () => ({ rateLimit: async () => null }));
  const { POST } = await import("@/app/api/admin/route");
  return POST(new Request("https://me.test/api/admin", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://me.test", host: "me.test" }, body: JSON.stringify(body),
  }));
}

describe("admin: grant plan by email", () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/admin/server"); vi.doUnmock("@/lib/abuse"); });

  it("writes the audit row first, then the grant, then a .done row", async () => {
    const { db, ops } = fakeDb();
    const res = await post(db, { action: "grant", email: " Friend@Example.com ", tier: "premium", expires_at: null });
    expect(res.status).toBe(200);
    expect(ops.map(([t, op]) => `${t}:${op}`)).toEqual(["admin_audit_log:insert", "admin_grant_plan:rpc", "admin_audit_log:insert"]);
    expect(ops[0][2]).toMatchObject({ action: "grant.create", target: "friend@example.com", after: { tier: "premium", expires_at: null } });
    expect(ops[1][2]).toEqual({ e: "friend@example.com", t: "premium", exp: null, actor: owner.id });
  });

  it("an existing grant is logged as an update; revoke as grant.revoke", async () => {
    const { db, ops } = fakeDb({ existing: { tier: "pro", expires_at: null, applied_user_id: null } });
    expect((await post(db, { action: "grant", email: "a@example.com", tier: "premium", expires_at: null })).status).toBe(200);
    expect((await post(db, { action: "ungrant", email: "a@example.com" })).status).toBe(200);
    const actions = ops.filter(([t]) => t === "admin_audit_log").map(([, , r]) => (r as { action: string }).action);
    expect(actions).toEqual(["grant.update", "grant.update.done", "grant.revoke", "grant.revoke.done"]);
    expect(ops.some(([t]) => t === "admin_revoke_grant")).toBe(true);
  });

  it("a failed audit write grants nothing (500)", async () => {
    const { db, ops } = fakeDb({ auditFails: true });
    expect((await post(db, { action: "grant", email: "a@example.com", tier: "pro", expires_at: null })).status).toBe(500);
    expect(ops.filter(([t]) => t !== "admin_audit_log")).toEqual([]);
  });

  it("rejects bad input: not an email, past expiry, unknown tier, revoking a grant that doesn't exist", async () => {
    const { db, ops } = fakeDb();
    for (const body of [
      { action: "grant", email: "not-an-email", tier: "pro", expires_at: null },
      { action: "grant", email: "a@example.com", tier: "pro", expires_at: "2020-01-01T00:00:00Z" },
      { action: "grant", email: "a@example.com", tier: "admin", expires_at: null },
    ]) expect((await post(db, body)).status).toBe(400);
    expect((await post(db, { action: "ungrant", email: "nobody@example.com" })).status).toBe(404);
    expect(ops).toEqual([]);
  });
});

// ---------------------------------------------------------------- the owner's address is an admin after sign-in
describe("ADMIN_EMAILS includes kismetodds@gmail.com", () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/auth/server"); vi.doUnmock("@/lib/config"); vi.unstubAllEnvs(); });

  it("a verified sign-in with that email (any case) is admin; unverified is not", async () => {
    vi.stubEnv("ADMIN_EMAILS", "kismetodds@gmail.com, kiumarsmomtaz@gmail.com");
    vi.doMock("@/lib/config", async (orig) => ({ ...(await orig<object>()), DEMO_MODE: false }));
    let user: { id: string; email: string; verified: boolean } = { id: "k1", email: "KismetOdds@gmail.com", verified: true };
    vi.doMock("@/lib/auth/server", () => ({ getUser: async () => user, supabaseAdmin: () => ({ service: true }) }));
    const m = await import("@/lib/admin/server");
    expect(await m.adminUser()).toEqual(user);
    expect((await m.requireAdmin()).db).toEqual({ service: true });
    user = { ...user, verified: false };
    expect(await m.adminUser()).toBeNull();
  });
});
