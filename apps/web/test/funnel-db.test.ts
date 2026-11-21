// T-299: the funnel migration in a real Postgres (PGlite, every migration in order, as test/rls.test.ts does).
// Proves the dedupe the app relies on: the exact upsert PostgREST runs for supabase-js
// upsert(..., { onConflict: "user_id,event", ignoreDuplicates: true }) inserts once per user and step, while signed-out
// rows (user_id null) never collide; and admin_funnel() returns per-day counts to the service role only.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIG = path.resolve(__dirname, "../../../supabase/migrations");
const A = "00000000-0000-0000-0000-00000000000a";
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now(), last_sign_in_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz, refreshed_at timestamp, oauth_client_id uuid);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(MIG, f), "utf8"));
  await db.exec(`grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to service_role;
    insert into auth.users (id, email) values ('${A}', 'a@x.test');`);
});

const upsertOnce = (user: string, event: string) =>
  db.query<{ id: number }>(`insert into funnel_events (user_id, event) values ($1, $2) on conflict (user_id, event) do nothing returning id`, [user, event]);

describe("funnel_events (20261120000200_funnel_events.sql)", () => {
  it("a signed-in step inserts once; repeats return no row (the app reads that as 'already counted')", async () => {
    expect((await upsertOnce(A, "first_bets_view")).rows).toHaveLength(1);
    expect((await upsertOnce(A, "first_bets_view")).rows).toHaveLength(0);
    expect((await upsertOnce(A, "first_bets_view")).rows).toHaveLength(0);
    expect((await upsertOnce(A, "first_bet_click")).rows).toHaveLength(1);
  });

  it("signed-out rows (user_id null) never collide", async () => {
    for (let i = 0; i < 3; i++) await db.query(`insert into funnel_events (event) values ('landing_view')`);
    expect((await db.query<{ n: number }>(`select count(*)::int n from funnel_events where event = 'landing_view'`)).rows[0]!.n).toBe(3);
  });

  it("rejects unknown steps", async () => {
    await expect(db.query(`insert into funnel_events (event) values ('bogus')`)).rejects.toThrow(/check/);
  });

  it("admin_funnel(): per-day counts; service role only", async () => {
    const rows = (await db.query<{ day: string; event: string; n: number }>(`select day::text, event, n::int from admin_funnel(30) order by event`)).rows;
    const today = (await db.query<{ d: string }>(`select ((now() at time zone 'utc')::date)::text d`)).rows[0]!.d;
    expect(rows).toEqual([
      { day: today, event: "first_bet_click", n: 1 }, { day: today, event: "first_bets_view", n: 1 }, { day: today, event: "landing_view", n: 3 },
    ]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query(`select * from admin_funnel(30)`), role).rejects.toThrow(/permission denied/);
        expect((await db.query(`select * from funnel_events`).catch(() => ({ rows: [] }))).rows, role).toEqual([]);
      } finally {
        await db.exec("reset role");
      }
    }
  });

  it("deleting the account deletes its rows", async () => {
    await db.exec(`delete from auth.users where id = '${A}'`);
    expect((await db.query(`select 1 from funnel_events where user_id = '${A}'`)).rows).toEqual([]);
  });
});
