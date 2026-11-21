// T-40: runs the real migrations in an in-process Postgres (PGlite) with a minimal stand-in for
// Supabase's auth schema, then proves RLS: user B can't see or touch user A's rows, anon sees nothing,
// every public table has rowsecurity = true, and the signup / session-limit triggers work.
// The same checks against a real Supabase DB: supabase/tests/rls.test.sql (pgTAP, `supabase test db`).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIG = path.resolve(__dirname, "../../../supabase/migrations");
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

// What Supabase provides before user migrations run (trimmed to what ours touch).
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
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
`;
const GRANTS = `
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
`;

let db: PGlite;

async function as<T>(role: "anon" | "authenticated", sub: string | null, sql: string, params: unknown[] = [], clientId?: string) {
  const claims = JSON.stringify({ sub: sub ?? undefined, role, ...(clientId ? { client_id: clientId } : {}) });
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); select set_config('request.jwt.claims', '${claims}', false);`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);
  for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIG, f), "utf8"));
  }
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test');`);
  await as("authenticated", A, `insert into presets (name, query) values ('A view', '{"v":1}')`);
  await as("authenticated", A, `insert into watchlist (market_id, side_index) values ('m1', null)`);
  // journal is Pro-only at the policy level (RT-11); A is Free, so A's row is seeded as the service role
  await db.exec(`insert into journal (user_id, market_id, side_index, price, shares) values ('${A}', 'm1', 0, 0.5, 10)`);
}, 60_000);

describe("RLS (supabase/migrations)", () => {
  it("every public table has row level security on", async () => {
    const rows = (await db.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public'")).rows;
    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(rows.filter((r) => !r.rowsecurity)).toEqual([]);
  });

  it("signup trigger creates profile + free subscription", async () => {
    const subs = (await db.query<{ user_id: string; tier: string }>("select user_id, tier from subscriptions order by user_id")).rows;
    expect(subs).toEqual([{ user_id: A, tier: "free" }, { user_id: B, tier: "free" }]);
    expect((await db.query("select 1 from profiles")).rows).toHaveLength(2);
  });

  it("user B sees none of user A's rows", async () => {
    for (const t of ["presets", "watchlist", "journal", "profiles", "subscriptions"]) {
      const mine = await as<{ user_id: string }>("authenticated", B, `select user_id from ${t}`);
      expect(mine.every((r) => r.user_id === B), t).toBe(true);
    }
    expect(await as("authenticated", B, "select * from presets")).toEqual([]);
    expect(await as("authenticated", A, "select * from presets")).toHaveLength(1);
  });

  it("user B can't update or delete A's rows, nor insert rows as A", async () => {
    await as("authenticated", B, "update presets set name = 'hacked'");
    await as("authenticated", B, "delete from journal");
    expect((await db.query<{ name: string }>("select name from presets")).rows[0].name).toBe("A view");
    expect((await db.query("select 1 from journal")).rows).toHaveLength(1);
    await expect(as("authenticated", B, `insert into presets (user_id, name, query) values ('${A}', 'x', '{}')`)).rejects.toThrow(/row-level security/);
  });

  it("users can't write their own tier; anon sees nothing", async () => {
    await as("authenticated", A, "update subscriptions set tier = 'premium'");
    expect((await db.query<{ tier: string }>(`select tier from subscriptions where user_id = '${A}'`)).rows[0].tier).toBe("free");
    await expect(as("authenticated", A, "insert into stripe_events (id, type) values ('evt', 'x')")).rejects.toThrow(/row-level security/);
    for (const t of ["presets", "profiles", "subscriptions", "stripe_events", "journal"]) {
      expect(await as("anon", null, `select * from ${t}`), t).toEqual([]);
    }
  });

  it("every public table: B can't read, change or delete A's rows, or insert as A; anon sees nothing (docs/15 § Database)", async () => {
    const seed: Record<string, string> = {   // one row of A's in each table that has none yet (as the service role)
      dashboards: `insert into dashboards (user_id, name, layout) values ('${A}', 'd', '[]')`,
      alert_rules: `insert into alert_rules (user_id, name, kind) values ('${A}', 'r', 'closing_soon')`,
      alert_events: `insert into alert_events (user_id, market_id, dedupe_key) values ('${A}', 'm1', 'k-a')`,
      push_subscriptions: `insert into push_subscriptions (user_id, endpoint, keys) values ('${A}', 'https://push.example/a', '{}')`,
      drawer_reveals: `insert into drawer_reveals (user_id, market_id) values ('${A}', 'm1')`,
      stripe_events: `insert into stripe_events (id, type) values ('evt_a', 'checkout.session.completed')`,
      admin_audit_log: `insert into admin_audit_log (actor_id, actor_email, action, target) values ('${A}', 'a@x.test', 'settings.update', 'banner_on')`,
      app_settings: `insert into app_settings (key, value) values ('banner_on', 'true')`,
      plan_grants: `insert into plan_grants (email, tier, created_by, updated_by) values ('later@x.test', 'pro', '${A}', '${A}')`,
      funnel_events: `insert into funnel_events (user_id, event) values ('${A}', 'signup_done')`,
      lifecycle_emails: `insert into lifecycle_emails (user_id, kind) values ('${A}', 'welcome')`,
    };
    for (const sql of Object.values(seed)) await db.exec(sql);
    const tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
    expect(tables.sort()).toEqual(["admin_audit_log", "alert_events", "alert_rules", "app_settings", "dashboards", "drawer_reveals",
      "funnel_events", "journal", "lifecycle_emails", "plan_grants", "presets", "profiles", "push_subscriptions", "stripe_events", "subscriptions", "watchlist"]);   // a new table must be added here, and to seed

    for (const t of tables) {
      const total = Number((await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n);
      expect(total, `${t} has a row to protect`).toBeGreaterThan(0);
      expect(await as("anon", null, `select * from ${t}`), `anon ${t}`).toEqual([]);
      const seen = await as<Record<string, unknown>>("authenticated", B, `select * from ${t}`);
      expect(seen.filter((r) => r.user_id !== B), `B reads ${t}`).toEqual([]);
      if (["stripe_events", "admin_audit_log", "app_settings", "plan_grants", "funnel_events", "lifecycle_emails"].includes(t)) expect(seen, `${t}: service role only`).toEqual([]);
      await as("authenticated", B, `delete from ${t}`).catch(() => {});
      const after = Number((await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n);
      expect(after, `B deletes from ${t}`).toBe(total);
    }
    for (const [t, sql] of Object.entries(seed).filter(([t]) => !["stripe_events", "admin_audit_log", "app_settings", "plan_grants"].includes(t))) {
      await expect(as("authenticated", B, sql.replace(/'k-a'/, "'k-b'").replace("/a'", "/b'")), `B inserts into ${t} as A`).rejects.toThrow(/row-level security/);
    }
    await as("authenticated", B, `update alert_rules set webhook_url = 'https://evil.example'`);
    expect((await db.query<{ w: string | null }>("select webhook_url as w from alert_rules")).rows).toEqual([{ w: null }]);
  });

  it("T-280: an OAuth-client token (client_id claim) can't read or write even its own user's rows", async () => {
    const CLIENT = "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d";
    const tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
    for (const t of tables) {
      const policy = (await db.query<{ permissive: string }>(`select permissive from pg_policies where tablename = $1 and policyname = 'no oauth clients'`, [t])).rows;
      expect(policy, `${t} has the restrictive OAuth-client policy`).toEqual([{ permissive: "RESTRICTIVE" }]);
      expect(await as("authenticated", A, `select * from ${t}`, [], CLIENT), `client reads ${t}`).toEqual([]);
    }
    // the browser session (no client_id) still reads A's own rows
    expect(await as("authenticated", A, "select * from watchlist")).toHaveLength(1);
    expect(await as("authenticated", A, "select * from subscriptions")).toHaveLength(1);
    await expect(as("authenticated", A, `insert into watchlist (market_id, side_index) values ('m9', null)`, [], CLIENT)).rejects.toThrow(/row-level security/);
    await as("authenticated", A, "update profiles set onboarded_at = now()", [], CLIENT);
    await as("authenticated", A, "delete from watchlist", [], CLIENT);
    expect(await as("authenticated", A, "select * from watchlist")).toHaveLength(1);
    expect((await db.query<{ o: string | null }>(`select onboarded_at as o from profiles where user_id = '${A}'`)).rows[0].o).toBeNull();
  });

  it("security definer functions pin search_path and can't be called by clients", async () => {
    const fns = (await db.query<{ name: string; config: string[] | null; anon: boolean; auth: boolean }>(`
      select p.proname as name, p.proconfig as config,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef`)).rows;
    expect(fns.map((f) => f.name).sort()).toEqual(["admin_activation", "admin_funnel", "admin_grant_plan", "admin_overview", "admin_revoke_grant", "admin_revoke_sessions",
      "admin_user_detail", "admin_users", "apply_pending_plan_grant", "enforce_session_limit", "handle_new_user"]);
    for (const f of fns) {
      expect(f.config, f.name).toContain("search_path=\"\"");
      expect([f.anon, f.auth], f.name).toEqual([false, false]);
    }
  });

  it("admin tables: users and anon can't read or write them; only the service role can (T-140)", async () => {
    for (const role of [["authenticated", A], ["authenticated", B], ["anon", null]] as const) {
      for (const t of ["admin_audit_log", "app_settings"]) expect(await as(role[0], role[1], `select * from ${t}`), `${role[0]} reads ${t}`).toEqual([]);
      await expect(as(role[0], role[1], "insert into app_settings (key, value) values ('maintenance', 'true')"), `${role[0]} writes app_settings`).rejects.toThrow(/row-level security/);
      await expect(as(role[0], role[1], `insert into admin_audit_log (actor_id, actor_email, action) values ('${B}', 'b@x.test', 'forged')`), `${role[0]} forges audit`).rejects.toThrow(/row-level security/);
      await as(role[0], role[1], "update app_settings set value = 'false'");
      await as(role[0], role[1], "delete from app_settings");
    }
    expect((await db.query<{ value: unknown }>("select value from app_settings where key = 'banner_on'")).rows).toEqual([{ value: true }]);
    // users can't comp themselves
    await as("authenticated", B, "update subscriptions set comp_tier = 'premium'");
    expect((await db.query<{ c: string | null }>(`select comp_tier as c from subscriptions where user_id = '${B}'`)).rows).toEqual([{ c: null }]);
  });

  it("admin_audit_log is append-only, even for the service role", async () => {
    await expect(db.exec("update admin_audit_log set action = 'x'")).rejects.toThrow(/append-only/);
    await expect(db.exec("delete from admin_audit_log")).rejects.toThrow(/append-only/);
    await expect(db.exec("truncate admin_audit_log")).rejects.toThrow(/append-only/);
    expect((await db.query("select 1 from admin_audit_log")).rows).toHaveLength(1);
  });

  it("admin functions: service role only; overview, search, detail and revoke work", async () => {
    for (const [role, sub] of [["authenticated", A], ["anon", null]] as const) {
      await expect(as(role, sub, "select public.admin_overview()")).rejects.toThrow(/permission denied/);
      await expect(as(role, sub, `select public.admin_revoke_sessions('${B}')`)).rejects.toThrow(/permission denied/);
      await expect(as(role, sub, "select * from public.admin_users('', 10, 0)")).rejects.toThrow(/permission denied/);
      await expect(as(role, sub, `select public.admin_user_detail('${B}')`)).rejects.toThrow(/permission denied/);
    }
    const o = (await db.query<{ r: { users_total: number; tiers: Record<string, number>; signups: unknown[] } }>("select public.admin_overview() as r")).rows[0].r;
    expect(o.users_total).toBe(2);
    expect(o.tiers.free).toBe(2);
    expect(o.signups).toHaveLength(30);
    await db.exec(`update subscriptions set comp_tier = 'pro' where user_id = '${B}'`);
    const o2 = (await db.query<{ r: { tiers: Record<string, number> } }>("select public.admin_overview() as r")).rows[0].r;
    expect([o2.tiers.free, o2.tiers.pro, o2.tiers.comped]).toEqual([1, 1, 1]);
    const found = (await db.query<{ email: string; total: number }>("select email, total::int as total from public.admin_users('B@X', 10, 0)")).rows;
    expect(found).toEqual([{ email: "b@x.test", total: 1 }]);
    expect((await db.query("select * from public.admin_users('%', 10, 0)")).rows).toEqual([]);   // % is literal, not a wildcard
    const d = (await db.query<{ r: { email: string; counts: Record<string, number> } }>(`select public.admin_user_detail('${A}') as r`)).rows[0].r;
    expect(d.email).toBe("a@x.test");
    expect(d.counts).toMatchObject({ presets: 1, watchlist: 1, journal: 1 });
    await db.exec(`insert into auth.sessions (user_id) values ('${B}'), ('${B}')`);
    expect((await db.query<{ n: number }>(`select public.admin_revoke_sessions('${B}') as n`)).rows[0].n).toBe(2);
    expect((await db.query(`select 1 from auth.sessions where user_id = '${B}'`)).rows).toEqual([]);
    await db.exec(`update subscriptions set comp_tier = null where user_id = '${B}'`);
  });

  it("auth.sessions is not reachable from the public API", async () => {
    await expect(as("authenticated", B, "select * from auth.sessions")).rejects.toThrow(/permission denied/);
    await expect(as("anon", null, "select * from auth.sessions")).rejects.toThrow(/permission denied/);
  });

  it("watchlist: one whole-market row per market (nulls not distinct)", async () => {
    await expect(as("authenticated", A, "insert into watchlist (market_id, side_index) values ('m1', null)")).rejects.toThrow(/duplicate key/);
  });

  it("RT-08: plan quotas are enforced by the database, not only the API (count-then-insert race)", async () => {
    // A is Free (presets 1, watchlist 10, dashboards 0, alert_rules 0) and already holds 1 preset + 1 watchlist row.
    await expect(as("authenticated", A, `insert into presets (name, query) values ('second', '{}')`)).rejects.toThrow(/plan_quota/);
    for (let i = 2; i <= 10; i++) await as("authenticated", A, `insert into watchlist (market_id) values ('w${i}')`);
    await expect(as("authenticated", A, `insert into watchlist (market_id) values ('w11')`)).rejects.toThrow(/plan_quota/);
    await expect(as("authenticated", A, `insert into dashboards (name, layout) values ('d', '[]')`)).rejects.toThrow(/plan_quota/);
    await expect(as("authenticated", A, `insert into alert_rules (name, kind) values ('r', 'closing_soon')`)).rejects.toThrow(/plan_quota/);
    // Pro: 3 dashboards; the 4th is refused. The service role (webhooks, admin) is not bound.
    await db.exec(`update subscriptions set tier = 'pro' where user_id = '${B}'`);
    for (let i = 0; i < 3; i++) await as("authenticated", B, `insert into dashboards (name, layout) values ('d${i}', '[]')`);
    await expect(as("authenticated", B, `insert into dashboards (name, layout) values ('d3', '[]')`)).rejects.toThrow(/plan_quota/);
    await db.exec(`insert into dashboards (user_id, name, layout) values ('${B}', 'by service', '[]')`);
    await db.exec(`update subscriptions set tier = 'free' where user_id = '${B}'`);
    await db.exec(`delete from dashboards where user_id = '${B}'`);
  });

  it("RT-11: users can't forge server-owned profile columns or write Pro-only rows with their own JWT", async () => {
    await expect(as("authenticated", A, "update profiles set accepted_terms_at = '2000-01-01'")).rejects.toThrow(/set by the server/);
    await expect(as("authenticated", A, "update profiles set created_at = '2000-01-01'")).rejects.toThrow(/set by the server/);
    await as("authenticated", A, "update profiles set onboarded_at = now(), theme = 'light'");   // user-owned columns still work
    expect((await db.query<{ t: string | null; o: string | null; th: string }>(
      `select accepted_terms_at as t, onboarded_at as o, theme as th from profiles where user_id = '${A}'`)).rows[0])
      .toMatchObject({ t: null, o: expect.anything(), th: "light" });
    await db.exec(`update profiles set accepted_terms_at = now() where user_id = '${A}'`);   // the callback (service role)
    await expect(as("authenticated", A, `insert into journal (market_id, side_index, price, shares) values ('m2', 0, 0.5, 1)`)).rejects.toThrow(/row-level security/);
    await db.exec(`update subscriptions set tier = 'pro' where user_id = '${B}'`);
    expect(await as("authenticated", B, `insert into journal (market_id, side_index, price, shares) values ('m2', 0, 0.5, 1) returning market_id`)).toEqual([{ market_id: "m2" }]);
    await db.exec(`update subscriptions set tier = 'free' where user_id = '${B}'; delete from journal where user_id = '${B}'`);
  });

  it("T-276: first_bets_at is server-owned, and the activation counts are service-role only", async () => {
    await expect(as("authenticated", A, "update profiles set first_bets_at = now()")).rejects.toThrow(/set by the server/);
    await db.exec(`update profiles set first_bets_at = now() where user_id = '${A}' and first_bets_at is null`);   // lib/activation.ts
    await expect(as("authenticated", A, "update profiles set first_bets_at = null")).rejects.toThrow(/set by the server/);
    await expect(as("authenticated", A, "select public.admin_activation()")).rejects.toThrow(/permission denied/);
    const r = (await db.query<{ a: { first_bets_total: number; days: { first_bets: number }[] } }>("select public.admin_activation() as a")).rows[0]!.a;
    expect(r.first_bets_total).toBe(1);
    expect(r.days).toHaveLength(30);
    expect(r.days.at(-1)!.first_bets).toBe(1);
    await db.exec(`update profiles set first_bets_at = null where user_id = '${A}'`);
  });

  it("RT-08/RT-11 + admin comps: the database uses the same plan as the app (Stripe tier or an unexpired comp)", async () => {
    await db.exec(`update subscriptions set comp_tier = 'pro', comp_expires_at = now() + interval '1 day' where user_id = '${B}'`);
    expect(await as("authenticated", B, `insert into journal (market_id, side_index, price, shares) values ('m3', 0, 0.5, 1) returning market_id`)).toEqual([{ market_id: "m3" }]);
    await as("authenticated", B, `insert into dashboards (name, layout) values ('comped', '[]')`);   // Free allows 0, Pro 3
    await db.exec(`update subscriptions set comp_expires_at = now() - interval '1 minute' where user_id = '${B}'`);   // expired = Free
    await expect(as("authenticated", B, `insert into dashboards (name, layout) values ('late', '[]')`)).rejects.toThrow(/plan_quota/);
    await expect(as("authenticated", B, `insert into journal (market_id, side_index, price, shares) values ('m4', 0, 0.5, 1)`)).rejects.toThrow(/row-level security/);
    await db.exec(`update subscriptions set comp_tier = null, comp_expires_at = null where user_id = '${B}'; delete from journal where user_id = '${B}'; delete from dashboards where user_id = '${B}'`);
  });

  it("keeps at most 3 sessions per user, newest win", async () => {
    for (let i = 1; i <= 4; i++) {
      await db.exec(`insert into auth.sessions (user_id, created_at) values ('${A}', now() + interval '${i} minutes')`);
    }
    const left = (await db.query<{ n: number }>(
      `select (created_at > now() + interval '90 seconds') as n from auth.sessions where user_id = '${A}'`)).rows;
    expect(left).toEqual([{ n: true }, { n: true }, { n: true }]); // the +1 min session was dropped
  });

  it("T-280: app connections (OAuth sessions) and browser sessions are capped at 3 each, separately", async () => {
    await db.exec(`delete from auth.sessions where user_id = '${A}'`);
    const app = "00000000-0000-0000-0000-0000000000c1";
    for (let i = 1; i <= 3; i++) await db.exec(`insert into auth.sessions (user_id, created_at) values ('${A}', now() + interval '${i} minutes')`);
    for (let i = 1; i <= 4; i++) await db.exec(`insert into auth.sessions (user_id, created_at, oauth_client_id) values ('${A}', now() + interval '${10 + i} minutes', '${app}')`);
    const rows = (await db.query<{ app: boolean; n: number }>(
      `select (oauth_client_id is not null) as app, count(*)::int as n from auth.sessions where user_id = '${A}' group by 1 order by 1`)).rows;
    expect(rows).toEqual([{ app: false, n: 3 }, { app: true, n: 3 }]);   // connecting an assistant signed no browser out
    await db.exec(`insert into auth.sessions (user_id, created_at) values ('${A}', now() + interval '1 hour')`);
    const after = (await db.query<{ app: boolean; n: number }>(
      `select (oauth_client_id is not null) as app, count(*)::int as n from auth.sessions where user_id = '${A}' group by 1 order by 1`)).rows;
    expect(after).toEqual([{ app: false, n: 3 }, { app: true, n: 3 }]);   // a 4th browser drops the oldest browser, not an app
  });

  it("deleting the auth user removes every row (delete account)", async () => {
    await db.exec(`delete from auth.users where id = '${A}'`);
    for (const t of ["presets", "watchlist", "journal", "profiles", "subscriptions"]) {
      expect((await db.query(`select 1 from ${t} where user_id = '${A}'`)).rows, t).toEqual([]);
    }
  });
});
