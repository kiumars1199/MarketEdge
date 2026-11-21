// Red-team run 2 DB repros. Copy to apps/web/test/ and run
// `pnpm exec vitest run test/rt2-db.test.ts --silent=false`.
// Applies every supabase/migrations/*.sql to PGlite (so the T-140/RT fix triggers are live) and attacks
// the admin tables + the run-1 fixes with a plain `authenticated` JWT, the way a user hits PostgREST directly.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const UID = "00000000-0000-0000-0000-00000000000a";

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz, created_at timestamptz default now(), last_sign_in_at timestamptz);
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, created_at timestamptz default now(), updated_at timestamptz, refreshed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;`);
  const MIG = path.resolve(__dirname, "../../../supabase/migrations");
  for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(MIG, f), "utf8"));
  // Supabase's default grants: tables are reachable by anon/authenticated; RLS is what actually gates them.
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
    insert into auth.users (id, email, email_confirmed_at) values ('${UID}', 'a@x.test', now());`);
  const as = async (role: "authenticated" | "service_role", sql: string) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${UID}', false);`);
    try { return { rows: (await db.query(sql)).rows as Record<string, unknown>[], error: null as string | null }; }
    catch (e) { return { rows: [], error: (e as Error).message }; }
    finally { await db.exec("reset role;"); }
  };
  return { db, as };
}

describe("RT2: admin tables are service-role only, even with a user JWT", () => {
  it("authenticated cannot read or write app_settings or admin_audit_log", async () => {
    const { as } = await freshDb();
    const settingsWrite = await as("authenticated", `insert into app_settings (key, value) values ('free_rows', '999'::jsonb) returning key`);
    const settingsUpsert = await as("authenticated", `insert into app_settings (key, value) values ('maintenance', 'false'::jsonb) on conflict (key) do update set value = 'false'::jsonb returning key`);
    const settingsRead = await as("authenticated", `select * from app_settings`);
    const auditWrite = await as("authenticated", `insert into admin_audit_log (actor_id, actor_email, action) values ('${UID}', 'a@x.test', 'x') returning id`);
    const auditRead = await as("authenticated", `select * from admin_audit_log`);
    console.log("app_settings insert  :", settingsWrite.error ?? `OK rows=${settingsWrite.rows.length}`);
    console.log("app_settings upsert  :", settingsUpsert.error ?? `OK rows=${settingsUpsert.rows.length}`);
    console.log("app_settings select  :", settingsRead.error ?? `rows=${settingsRead.rows.length}`);
    console.log("audit_log insert     :", auditWrite.error ?? `OK rows=${auditWrite.rows.length}`);
    console.log("audit_log select     :", auditRead.error ?? `rows=${auditRead.rows.length}`);
    // Permission denied (revoke all) OR zero rows (RLS, no policy) — never a successful write.
    expect(settingsWrite.error ? true : settingsWrite.rows.length === 0).toBe(true);
    expect(settingsUpsert.error ? true : settingsUpsert.rows.length === 0).toBe(true);
    expect(auditWrite.error ? true : auditWrite.rows.length === 0).toBe(true);
  });

  it("admin_audit_log is append-only even for the service role", async () => {
    const { as } = await freshDb();
    const ins = await as("service_role", `insert into admin_audit_log (actor_id, actor_email, action) values ('${UID}', 'a@x.test', 'settings.update') returning id`);
    const upd = await as("service_role", `update admin_audit_log set action = 'tampered' returning id`);
    const del = await as("service_role", `delete from admin_audit_log returning id`);
    console.log("audit insert (svc)   :", ins.error ?? `OK id=${ins.rows[0]?.id}`);
    console.log("audit update (svc)   :", upd.error ?? "UPDATE ALLOWED (bad)");
    console.log("audit delete (svc)   :", del.error ?? "DELETE ALLOWED (bad)");
    expect(ins.error).toBeNull();
    expect(upd.error).toMatch(/append-only/);
    expect(del.error).toMatch(/append-only/);
  });
});

describe("RT2: run-1 RLS / quota fixes (RT-08, RT-11)", () => {
  it("comp_tier and tier stay server-owned; terms timestamp can't be forged", async () => {
    const { as } = await freshDb();
    const compUpd = await as("authenticated", `update subscriptions set comp_tier = 'premium', tier = 'premium' returning tier, comp_tier`);
    const compUps = await as("authenticated", `insert into subscriptions (user_id, tier, comp_tier) values ('${UID}', 'premium', 'premium') on conflict (user_id) do update set tier = 'premium', comp_tier = 'premium' returning tier`);
    const terms = await as("authenticated", `update profiles set accepted_terms_at = '2000-01-01' returning accepted_terms_at`);
    const now = await as("service_role", `select tier, comp_tier, accepted_terms_at from subscriptions s join profiles p using (user_id)`);
    console.log("comp/tier update     :", compUpd.error ?? `rows=${compUpd.rows.length}`);
    console.log("comp/tier upsert     :", compUps.error ?? `rows=${compUps.rows.length}`);
    console.log("terms forge          :", terms.error ?? `rows=${terms.rows.length}`);
    console.log("db now               :", JSON.stringify(now.rows[0]));
    expect(now.rows[0]?.tier).toBe("free");
    expect(now.rows[0]?.comp_tier ?? null).toBeNull();
    expect(now.rows[0]?.accepted_terms_at ?? null).toBeNull();
  });

  it("plan quotas are enforced by the DB (free: presets<=1, alert_rules=0, watchlist<=10)", async () => {
    const { as } = await freshDb();
    let presetOk = 0;
    for (let i = 0; i < 20; i++) if (!(await as("authenticated", `insert into presets (name, query) values ('p${i}', '{}'::jsonb) returning id`)).error) presetOk++;
    let alertOk = 0;
    for (let i = 0; i < 10; i++) if (!(await as("authenticated", `insert into alert_rules (name, kind) values ('r${i}', 'closing_soon') returning id`)).error) alertOk++;
    let wlOk = 0;
    for (let i = 0; i < 20; i++) if (!(await as("authenticated", `insert into watchlist (market_id, side_index) values ('m${i}', 0) returning id`)).error) wlOk++;
    const journal = await as("authenticated", `insert into journal (market_id, side_index, price, shares) values ('m', 0, 0.5, 1) returning id`);
    console.log(`presets stored (limit 1) : ${presetOk}`);
    console.log(`alert_rules stored (0)   : ${alertOk}`);
    console.log(`watchlist stored (10)    : ${wlOk}`);
    console.log("journal on free plan     :", journal.error ?? `INSERTED id=${journal.rows[0]?.id} (bad)`);
    expect(presetOk).toBe(1);
    expect(alertOk).toBe(0);
    expect(wlOk).toBe(10);
    expect(journal.error).not.toBeNull();   // Pro feature: insert policy requires a paid plan
  });
});

describe("RT2: IP key no longer trusts client X-Forwarded-For (RT-07)", () => {
  it("off-Vercel every anon caller shares one key; rotating XFF does not help", async () => {
    const { clientKey, clientIp } = await import("@/lib/abuse");
    delete process.env.VERCEL;
    const k1 = clientKey(new Request("http://x/api/markets", { headers: { "x-forwarded-for": "1.1.1.1" } }));
    const k2 = clientKey(new Request("http://x/api/markets", { headers: { "x-forwarded-for": "9.9.9.9", "x-real-ip": "9.9.9.9" } }));
    console.log("anon key (xff 1.1.1.1):", k1);
    console.log("anon key (xff 9.9.9.9):", k2);
    console.log("clientIp              :", clientIp(new Request("http://x", { headers: { "x-forwarded-for": "2.2.2.2" } })));
    expect(k1).toBe(k2);          // same key regardless of client headers
    expect(k1).toBe("ip:local");
  });
});
