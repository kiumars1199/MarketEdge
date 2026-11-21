// T-299 funnel: step rules, path mapping, report math, server recording (once per user, PostHog only when counted),
// the API route refusing server steps, and the webhook hook. Supabase and PostHog are fakes; nothing leaves the process.
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { FUNNEL_STEPS, allowed, funnelReport, isClientStep, stepForPath } from "./funnel";
import { recordFunnel } from "./funnel-server";
import { afterBillingEvent, onFirstSignIn } from "./email/lifecycle";

/** funnel_events with the migration's unique (user_id, event); NULL user ids never collide (Postgres semantics). */
export function fakeFunnelDb(opts: { fail?: string } = {}) {
  const rows: { user_id: string | null; event: string; day: string }[] = [];
  const err = () => (opts.fail ? { message: opts.fail } : null);
  const db = {
    rows,
    from: (t: string) => {
      expect(t).toBe("funnel_events");
      return {
        upsert: (row: { user_id: string; event: string; day: string }, o: { onConflict: string; ignoreDuplicates: boolean }) => {
          expect(o).toEqual({ onConflict: "user_id,event", ignoreDuplicates: true });
          return {
            select: async () => {
              if (opts.fail) return { data: null, error: err() };
              if (rows.some((r) => r.user_id === row.user_id && r.event === row.event)) return { data: [], error: null };
              rows.push(row);
              return { data: [{ id: rows.length }], error: null };
            },
          };
        },
        insert: async (row: { event: string; day: string }) => {
          if (opts.fail) return { error: err() };
          rows.push({ user_id: null, ...row });
          return { error: null };
        },
      };
    },
  };
  return db as typeof db & SupabaseClient;
}

const deps = (db: ReturnType<typeof fakeFunnelDb>, extra: { posthogKey?: string; fetchImpl?: typeof fetch } = {}) =>
  ({ db: () => db, today: () => "2026-11-20", ...extra });

describe("funnel steps", () => {
  it("maps committed paths to page-view steps", () => {
    expect(stepForPath("/")).toBe("landing_view");
    expect(stepForPath("/signup")).toBe("signup_start");
    expect(stepForPath("/signup/")).toBe("signup_start");
    expect(stepForPath("/bets")).toBe("first_bets_view");
    expect(stepForPath("/pricing")).toBe("upgrade_view");
    expect(stepForPath("/bets/today")).toBeNull();
    expect(stepForPath("/login")).toBeNull();
  });

  it("browsers may send only client steps, each from the right side of the account wall", () => {
    for (const s of ["signup_done", "trial_start", "paid", "nope", 1, null]) expect(isClientStep(s), String(s)).toBe(false);
    expect(allowed("landing_view", false)).toBe(true);
    expect(allowed("landing_view", true)).toBe(false);      // a signed-in visit to / is not a landing view
    expect(allowed("signup_start", true)).toBe(false);
    expect(allowed("first_bets_view", false)).toBe(false);  // "first" steps are per account
    expect(allowed("first_bet_click", false)).toBe(false);
    expect(allowed("first_bet_click", true)).toBe(true);
    expect(allowed("upgrade_view", false) && allowed("upgrade_view", true)).toBe(true);
  });

  it("report: daily counts, totals and step-to-step conversion", () => {
    const r = funnelReport([
      { day: "2026-11-19", event: "landing_view", n: 100 }, { day: "2026-11-20", event: "landing_view", n: 100 },
      { day: "2026-11-20", event: "signup_start", n: 50 }, { day: "2026-11-20", event: "signup_done", n: 20 },
      { day: "2026-11-20", event: "first_bets_view", n: 10 }, { day: "2026-10-01", event: "paid", n: 99 },   // outside the window
      { day: "2026-11-20", event: "bogus", n: 5 },
    ], "2026-11-20", 30);
    expect(r.days).toHaveLength(30);
    expect(r.days.at(-1)!.day).toBe("2026-11-20");
    expect(r.days.at(-1)!.counts.landing_view).toBe(100);
    expect(r.totals.landing_view).toBe(200);
    expect(r.totals.paid).toBe(0);
    expect(r.conversion.landing_view).toBeNull();
    expect(r.conversion.signup_start).toBe(0.25);
    expect(r.conversion.signup_done).toBe(0.4);
    expect(r.conversion.first_bets_view).toBe(0.5);
    expect(r.conversion.first_bet_click).toBe(0);
    expect(r.conversion.upgrade_view).toBeNull();            // previous step is 0
    expect(Object.keys(r.totals)).toEqual([...FUNNEL_STEPS]);
  });
});

describe("recordFunnel (server)", () => {
  it("signed in: once per user and step, however often it's called; PostHog only for the counted one", async () => {
    const db = fakeFunnelDb();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const d = deps(db, { posthogKey: "phc_test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await recordFunnel("first_bets_view", "u1", {}, d)).toBe(true);
    expect(await recordFunnel("first_bets_view", "u1", {}, d)).toBe(false);
    expect(await recordFunnel("first_bets_view", "u1", {}, d)).toBe(false);
    expect(await recordFunnel("first_bets_view", "u2", {}, d)).toBe(true);
    expect(db.rows.filter((r) => r.event === "first_bets_view")).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0]!;
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(String(init.body));
    expect(body.event).toBe("first_bets_view");
    expect(body.distinct_id).not.toBe("u1");                 // random per event: never the user id
    expect(body.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.properties.$process_person_profile).toBe(false);
    expect(JSON.stringify(body)).not.toContain("u1");
  });

  it("signed out: one row per call, no user id", async () => {
    const db = fakeFunnelDb();
    expect(await recordFunnel("landing_view", null, {}, deps(db))).toBe(true);
    expect(await recordFunnel("landing_view", null, {}, deps(db))).toBe(true);
    expect(db.rows).toEqual([{ user_id: null, event: "landing_view", day: "2026-11-20" }, { user_id: null, event: "landing_view", day: "2026-11-20" }]);
  });

  it("no PostHog key: recorded, nothing sent", async () => {
    const fetchImpl = vi.fn();
    expect(await recordFunnel("paid", "u1", {}, { ...deps(fakeFunnelDb(), { fetchImpl: fetchImpl as unknown as typeof fetch }), posthogKey: "" })).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never throws: no database, a missing table, or PostHog down all just return", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await recordFunnel("paid", "u1", {}, { db: () => null })).toBe(false);
    expect(await recordFunnel("paid", "u1", {}, deps(fakeFunnelDb({ fail: 'relation "funnel_events" does not exist' })))).toBe(false);
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await recordFunnel("paid", "u1", {}, deps(fakeFunnelDb(), { posthogKey: "k", fetchImpl: down as unknown as typeof fetch }))).toBe(true);
    warn.mockRestore();
  });
});

describe("POST /api/funnel", () => {
  const post = async (body: unknown, origin: string | null = "http://localhost") => {
    const { POST } = await import("@/app/api/funnel/route");
    return POST(new Request("http://localhost/api/funnel", {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    }));
  };
  it("refuses server-only steps and unknown steps; refuses other origins", async () => {
    for (const step of ["signup_done", "trial_start", "paid", "x"]) expect((await post({ step })).status, step).toBe(400);
    expect((await post({ step: "landing_view" }, "https://evil.example")).status).toBe(403);
    expect((await post({ step: "landing_view", extra: 1 })).status).toBe(400);
  });
  it("answers 200 { counted: false } when the funnel isn't set up (no Supabase), so pages never log an error", async () => {
    const res = await post({ step: "landing_view" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counted: false });
  });
});

describe("lifecycle hooks → funnel", () => {
  const U = "11111111-1111-1111-1111-111111111111";
  const billing = { userForCustomer: async (c: string) => (c === "cus_1" ? U : null), emailFor: async () => "a@x.test" };
  const ev = (type: string, object: object) => ({ id: `evt_${type}`, object: "event", type, data: { object } }) as unknown as Stripe.Event;

  it("signup_done once, and only for an account created in the last day", async () => {
    const db = fakeFunnelDb();
    const now = () => Date.parse("2026-11-20T12:00:00Z");
    const d = { funnel: deps(db), now };
    await onFirstSignIn({ id: U, created_at: "2026-11-20T11:59:00Z" }, d);
    await onFirstSignIn({ id: U, created_at: "2026-11-20T11:59:00Z" }, d);
    await onFirstSignIn({ id: "old", created_at: "2025-01-01T00:00:00Z" }, d);
    expect(db.rows).toEqual([{ user_id: U, event: "signup_done", day: "2026-11-20" }]);
  });

  it("trial_start from a trialing subscription; paid from the first invoice with money, once", async () => {
    const db = fakeFunnelDb();
    const d = { funnel: deps(db) };
    await afterBillingEvent(ev("customer.subscription.created", { id: "sub_1", customer: "cus_1", status: "active", trial_start: null, metadata: {} }), billing, d);
    await afterBillingEvent(ev("customer.subscription.created", { id: "sub_1", customer: "cus_1", status: "trialing", trial_start: 1, metadata: { user_id: U } }), billing, d);
    await afterBillingEvent(ev("invoice.paid", { id: "in_0", customer: "cus_1", amount_paid: 0 }), billing, d);   // trial's $0 invoice
    await afterBillingEvent(ev("invoice.paid", { id: "in_1", customer: "cus_1", amount_paid: 900 }), billing, d);
    await afterBillingEvent(ev("invoice.paid", { id: "in_2", customer: "cus_1", amount_paid: 900 }), billing, d);   // renewal
    await afterBillingEvent(ev("invoice.paid", { id: "in_3", customer: "cus_unknown", amount_paid: 900 }), billing, d);
    expect(db.rows.map((r) => r.event)).toEqual(["trial_start", "paid"]);
  });

  it("a failing hook never throws into the webhook", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { userForCustomer: async () => { throw new Error("db down"); }, emailFor: async () => null };
    await expect(afterBillingEvent(ev("invoice.paid", { id: "in", customer: "cus_1", amount_paid: 1 }), broken, {})).resolves.toBeUndefined();
    err.mockRestore();
  });
});
