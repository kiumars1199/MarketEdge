// Red-team run 3 DB checks. Copy to apps/web/test/ and run `pnpm exec vitest run test/rt3-db.test.ts --silent=false`.
// Every supabase/migrations/*.sql in PGlite with Supabase's default grants, then: which SECURITY DEFINER functions can
// a user JWT (authenticated) or anon execute, and do the admin RPCs / audit log hold against them.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const UID = "00000000-0000-0000-0000-00000000000a";
const VICTIM = "00000000-0000-0000-0000-00000000000b";

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz, created_at timestamptz default now(), last_sign_in_at timestamptz);
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, created_at timestamptz default now(), updated_at timestamptz, refreshed_at timestamptz);
    create table auth.refresh_tokens (id bigserial primary key, user_id text, session_id uuid, revoked boolean default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;`);
  const MIG = path.resolve(__dirname, "../../../supabase/migrations");
  for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(MIG, f), "utf8"));
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
    insert into auth.users (id, email, email_confirmed_at) values ('${UID}', 'a@x.test', now()), ('${VICTIM}', 'victim@x.test', now());
    insert into auth.sessions (user_id) values ('${VICTIM}');`);
  const as = async (role: "anon" | "authenticated" | "service_role", sql: string) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${role === "anon" ? "" : UID}', false);`);
    try { return { rows: (await db.query(sql)).rows as Record<string, unknown>[], error: null as string | null }; }
    catch (e) { return { rows: [], error: (e as Error).message }; }
    finally { await db.exec("reset role;"); }
  };
  return { db, as };
}

describe("RT3: SECURITY DEFINER functions and admin RPCs", () => {
  it("no definer function in public is executable by anon or authenticated", async () => {
    const { db } = await freshDb();
    const { rows } = await db.query<{ fn: string; anon: boolean; auth: boolean }>(`
      select p.oid::regprocedure::text as fn,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype`);
    for (const r of rows) console.log(`${r.fn.padEnd(48)} anon=${r.anon} authenticated=${r.auth}`);
    expect(rows.filter((r) => r.anon || r.auth)).toEqual([]);
  });

  it("a user JWT cannot call the admin RPCs (user list, detail, revoke another user's sessions)", async () => {
    const { as } = await freshDb();
    for (const sql of [`select * from public.admin_overview()`, `select * from public.admin_users('', 200, 0)`,
      `select public.admin_user_detail('${VICTIM}')`, `select public.admin_revoke_sessions('${VICTIM}')`]) {
      for (const role of ["anon", "authenticated"] as const) {
        const r = await as(role, sql);
        console.log(`${role.padEnd(13)} ${sql.padEnd(60)} -> ${r.error ?? `ALLOWED rows=${r.rows.length}`}`);
        expect(r.error).toMatch(/permission denied/);
      }
    }
  });

  it("audit log: user JWT cannot forge or read entries; service role cannot rewrite them", async () => {
    const { as } = await freshDb();
    const forge = await as("authenticated", `insert into admin_audit_log (actor_id, actor_email, action) values ('${UID}', 'owner@x.test', 'user.delete') returning id`);
    const read = await as("authenticated", `select * from admin_audit_log`);
    await as("service_role", `insert into admin_audit_log (actor_id, actor_email, action) values ('${UID}', 'a@x.test', 'settings.update')`);
    const upd = await as("service_role", `update admin_audit_log set actor_email = 'someone-else@x.test'`);
    const trunc = await as("service_role", `truncate admin_audit_log`);
    const disable = await as("service_role", `alter table admin_audit_log disable trigger user`);
    console.log("forge (authenticated):", forge.error ?? `rows=${forge.rows.length}`);
    console.log("read (authenticated) :", read.error ?? `rows=${read.rows.length}`);
    console.log("update (service)     :", upd.error ?? "ALLOWED");
    console.log("truncate (service)   :", trunc.error ?? "ALLOWED");
    console.log("disable trigger (svc):", disable.error ?? "ALLOWED");
    expect(forge.error ?? (forge.rows.length === 0 ? "none" : null)).not.toBeNull();
    expect(read.error ?? (read.rows.length === 0 ? "none" : null)).not.toBeNull();
    expect(upd.error).not.toBeNull();
    expect(trunc.error).not.toBeNull();
    expect(disable.error).not.toBeNull();
  });
});
