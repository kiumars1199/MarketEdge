// Red-team repros that need the app's own functions. Copy to apps/web/test/ and run
// `pnpm exec vitest run test/web-repro.test.ts --silent=false`.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", async (orig) => ({ ...(await orig<object>()), getTier: async () => "free" }));

describe("RT-03 quota race: count-then-insert", () => {
  it("20 parallel preset inserts on a Free plan (limit 1) all succeed", async () => {
    const { insertRow } = await import("@/lib/repo/server");
    const rows: unknown[] = [];
    const tick = () => new Promise((r) => setTimeout(r, 5));   // any real network round trip
    const db = {
      from: () => ({
        select: () => ({ then: (ok: (v: unknown) => void) => tick().then(() => ok({ count: rows.length })) }),
        insert: (row: unknown) => ({ select: () => ({ single: async () => { await tick(); rows.push(row); return { data: row, error: null }; } }) }),
      }),
    };
    const row = (i: number) => ({ name: `p${i}`, emoji: null, query: {}, columns: null, sort: null, is_default: false, position: i });
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => insertRow({ db: db as never, userId: "u" }, "presets", row(i))));
    console.log("statuses:", res.map((r) => r.status).join(","), "rows stored:", rows.length);
    expect(rows.length).toBe(20);
    const late = await insertRow({ db: db as never, userId: "u" }, "presets", row(99));
    expect(late.status).toBe(403);   // sequential requests are refused: only the race gets through
  });
});

describe("RT-08 rate-limit key is the client-supplied X-Forwarded-For", () => {
  it("61 requests in a minute with a rotated XFF never hit the 60/min limit", async () => {
    const { clientKey, memoryLimiter } = await import("@/lib/abuse");
    const lim = memoryLimiter(() => 1_000_000);
    const req = (ip: string) => new Request("http://x/api/markets", { headers: { "x-forwarded-for": ip } });
    let same = 0, rotated = 0;
    for (let i = 0; i < 61; i++) if ((await lim.limit("markets", clientKey(req("1.2.3.4")))).ok) same++;
    for (let i = 0; i < 61; i++) if ((await lim.limit("markets", clientKey(req(`10.0.${i >> 8}.${i & 255}`)))).ok) rotated++;
    console.log(`same IP: ${same}/61 allowed; rotated X-Forwarded-For: ${rotated}/61 allowed`);
    expect(same).toBe(60);
    expect(rotated).toBe(61);
  });
});

describe("RT-09 RLS: what a signed-in user can do with their own JWT straight against PostgREST", () => {
  it("forges accepted_terms_at / onboarded_at and skips plan quotas; cannot touch subscriptions", async () => {
    const db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key, email text);
      create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;`);
    const MIG = path.resolve(__dirname, "../../../supabase/migrations");
    for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(MIG, f), "utf8"));
    await db.exec(`grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;
      insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@x.test');`);
    const as = async (sql: string) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);`);
      try { return { rows: (await db.query(sql)).rows, error: null as string | null }; }
      catch (e) { return { rows: [], error: (e as Error).message }; }
      finally { await db.exec("reset role;"); }
    };
    console.log("terms forge:", JSON.stringify(await as("update profiles set accepted_terms_at = '2000-01-01', onboarded_at = now() returning accepted_terms_at")));
    for (let i = 0; i < 30; i++) await as(`insert into alert_rules (name, kind, channels, webhook_url) values ('r${i}', 'closing_soon', '{discord}', 'https://discord.com/api/webhooks/x')`);
    console.log("free user alert_rules (API limit 0):", JSON.stringify(await as("select count(*)::int as n from alert_rules")));
    console.log("free user journal (Pro feature):", JSON.stringify(await as("insert into journal (market_id, side_index, price, shares) values ('m', 0, 0.5, 1) returning id")).slice(0, 80));
    console.log("tier update:", JSON.stringify(await as("update subscriptions set tier = 'premium' returning tier")));
    console.log("tier insert:", JSON.stringify(await as("insert into subscriptions (user_id, tier) values ('00000000-0000-0000-0000-00000000000a', 'premium') on conflict (user_id) do update set tier = 'premium' returning tier")));
    console.log("reveal reset:", JSON.stringify(await as("delete from drawer_reveals returning *")));
    console.log("tier now:", JSON.stringify((await db.query("select tier from subscriptions")).rows));
  });
});
