// T-300 (docs/OVERHAUL.md §F4): lifecycle emails. Each one rendered; every link in it (HTML and text) resolves to a
// route of this app (the page.tsx / route.ts tree under app/); the unsubscribe link and List-Unsubscribe header only on
// the optional welcome; each hook sends exactly once however often its trigger fires, and a failed send can be retried.
// Resend is a mock (sendEmail with fetch stubbed, or a fake send); nothing leaves the process.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail, unsubscribeUrl, type Email } from "./index";
import { DISCLAIMER } from "./templates";
import { amount, cancelEmail, receiptEmail, trialEndingEmail, welcomeEmail } from "./lifecycle-templates";
import { afterBillingEvent, onFirstSignIn, runTrialReminders, sendOnce, trialsDue, type ClaimStore, type LifecycleKind, type MailDeps, type TrialRow } from "./lifecycle";
import { PROFIT_CLAIM } from "@/test/profit-claim";
import { GET as lifecycleGet } from "@/app/api/lifecycle/run/route";
import { handleWebhook, type BillingDb } from "@/lib/billing/stripe";

const SITE = "https://kismet.test";
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T15:41:00Z");
const BANNED = /guarantee|sure thing|can'?t lose|\block\b|\bpick\b|risk[- ]free|bet this/i;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- the app's route list
const APP = path.resolve(__dirname, "../../app");
/** Every URL path the app serves: app/**\/page.tsx and route.ts, route groups dropped, [x] = one segment, [...x] = rest.
 *  Left out: the root catch-all app/[...missing] (the 404 page, which would match anything) and the e2e mock. */
function appRoutes(dir = APP, segs: string[] = []): RegExp[] {
  const out: RegExp[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name.startsWith("_") || name.startsWith("@") || name === "e2e-mock") continue;   // private folders, parallel slots, test mock
      if (segs.length === 0 && /^\[\[?\.\.\./.test(name)) continue;                                // root catch-all = 404
      out.push(...appRoutes(p, /^\(.*\)$/.test(name) ? segs : [...segs, name]));
    } else if (/^(page|route)\.(tsx?|jsx?)$/.test(name)) {
      const re = segs.map((s) => (/^\[\[?\.\.\./.test(s) ? "(?:/.+)?" : /^\[.+\]$/.test(s) ? "/[^/]+" : `/${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).join("");
      out.push(new RegExp(`^${re || "/"}$`));
    }
  }
  return out;
}
const ROUTES = appRoutes();
const isRoute = (pathname: string) => ROUTES.some((r) => r.test(pathname));

/** Every link in an email: href="…" in the HTML, and every http(s) URL in the text part. */
function links(e: Email): string[] {
  const html = [...e.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
  const text = [...e.text.matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0].replace(/[.,)]+$/, ""));
  return [...html, ...text];
}

function renderAll() {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  vi.stubEnv("UNSUBSCRIBE_SECRET", "test-unsub-secret");
  return {
    welcome: welcomeEmail("a@b.test", unsubscribeUrl("user-1")),
    trial_ending: trialEndingEmail({ to: "a@b.test", plan: "Pro", endsAt: NOW + 2 * DAY, now: NOW }),
    receipt: receiptEmail({ to: "a@b.test", plan: "Premium", cents: 123456, currency: "usd", paidAt: NOW, invoice: "KIS-0001" }),
    cancel: cancelEmail({ to: "a@b.test", plan: "Pro", endsAt: NOW + 10 * DAY, now: NOW }),
    cancel_ended: cancelEmail({ to: "a@b.test", plan: "Premium", endsAt: null, now: NOW }),
  };
}

describe("lifecycle email templates", () => {
  it("the route list is the real app tree (sanity)", () => {
    for (const p of ["/", "/bets", "/account", "/pricing", "/api/unsubscribe", "/m/abc-123"]) expect(isRoute(p), p).toBe(true);
    for (const p of ["/nope", "/account/billing", "/bets/x/y/z"]) expect(isRoute(p), p).toBe(false);
  });

  it("each renders: subject, heading, disclaimer, plain wording; every link resolves to an app route on our site", () => {
    const all = renderAll();
    for (const [kind, e] of Object.entries(all)) {
      expect(e.to, kind).toBe("a@b.test");
      expect(e.subject.length, kind).toBeGreaterThan(0);
      for (const body of [e.html, e.text]) {
        expect(body, kind).toContain(DISCLAIMER);
        expect(body, kind).not.toMatch(BANNED);
        expect(body, kind).not.toMatch(PROFIT_CLAIM);
      }
      expect(e.html, kind).not.toMatch(/<script|undefined|NaN|null/);
      expect(e.text, kind).not.toMatch(/undefined|NaN/);
      const ls = links(e);
      expect(ls.length, kind).toBeGreaterThan(0);
      for (const l of ls) {
        const u = new URL(l);
        expect(u.origin, `${kind}: ${l}`).toBe(SITE);
        expect(isRoute(u.pathname), `${kind}: ${u.pathname} is not an app route`).toBe(true);
      }
    }
  });

  it("content: welcome explains a card in 3 lines; trial says when and how to cancel; receipt and cancel give the facts", () => {
    const m = renderAll();
    expect(m.welcome.text).toMatch(/Bet Yes/);
    expect(m.welcome.text).toMatch(/Wins about 7 in 10/);
    expect(m.welcome.text).toMatch(/\$10 wins \$5\.60/);
    expect(m.welcome.text).toMatch(/Why this bet\?/);
    expect(m.welcome.html.match(/<p style="margin:0 0 8px">/g)).toHaveLength(3);
    expect(m.welcome.html).toContain(`${SITE}/bets`);

    expect(m.trial_ending.subject).toBe("Your Kismet Pro trial ends in 2 days");
    expect(m.trial_ending.text).toContain("Sun, Nov 22, 2026");
    expect(m.trial_ending.text).toMatch(/To cancel: open your account, tap Manage billing and cancel there/);
    // The button the instructions name is the one /account renders (components/auth/AccountActions.tsx → Stripe portal).
    const account = readFileSync(path.resolve(__dirname, "../../app/account/page.tsx"), "utf8");
    const actions = readFileSync(path.resolve(__dirname, "../../components/auth/AccountActions.tsx"), "utf8");
    expect(account).toMatch(/<AccountActions kind="billing"/);
    expect(actions).toMatch(/goTo\("\/api\/stripe\/portal"[\s\S]{0,120}Manage billing/);
    for (const e of [m.trial_ending, m.receipt]) expect(e.text).toContain("Manage billing");
    expect(m.trial_ending.html).toContain(`${SITE}/account`);
    expect(trialEndingEmail({ to: "a", plan: "Pro", endsAt: NOW + 1.2 * DAY, now: NOW }).subject).toBe("Your Kismet Pro trial ends tomorrow");

    expect(m.receipt.subject).toBe("Receipt: $1,234.56 for Kismet Premium");
    expect(m.receipt.text).toContain("Invoice KIS-0001");
    expect(amount(900)).toBe("$9.00");

    expect(m.cancel.text).toContain("You keep Pro until Mon, Nov 30, 2026");
    expect(m.cancel_ended.subject).toBe("Your Kismet Premium plan has ended");
  });

  it("unsubscribe: the optional welcome has the link and List-Unsubscribe; trial, receipt and cancel notices have neither", async () => {
    const m = renderAll();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Kismet <hi@kismet.test>");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const [kind, e] of Object.entries(m)) {
      const optional = kind === "welcome";
      expect(!!e.unsubscribeUrl, kind).toBe(optional);
      expect(links(e).some((l) => new URL(l).pathname === "/api/unsubscribe"), kind).toBe(optional);
      expect(/unsubscribe/i.test(e.html.replace(/no unsubscribe link/g, "")), kind).toBe(optional);
      if (!optional) expect(e.text, kind).toContain("so it has no unsubscribe link");   // the reason, in the email itself
      expect((await sendEmail(e)).sent).toBe(true);
      const body = JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body));
      expect(body.headers?.["List-Unsubscribe"], kind).toBe(optional ? `<${e.unsubscribeUrl}>` : undefined);
      expect(body.headers?.["List-Unsubscribe-Post"], kind).toBe(optional ? "List-Unsubscribe=One-Click" : undefined);
    }
    expect(fetchMock).toHaveBeenCalledTimes(Object.keys(m).length);
  });
});

// ---------------------------------------------------------------- once-only sending
/** lifecycle_emails with its primary key (user_id, kind, ref), plus a mock Resend. */
function fakeMail(opts: { failSends?: number; tier?: string; current?: { tier: string; stripe_subscription_id: string } } = {}) {
  const current = opts.current;
  const claimed = new Set<string>();
  const key = (u: string, k: LifecycleKind, r: string) => `${u}|${k}|${r}`;
  const claims: ClaimStore = {
    claim: async (u, k, r) => (claimed.has(key(u, k, r)) ? false : (claimed.add(key(u, k, r)), true)),
    release: async (u, k, r) => { claimed.delete(key(u, k, r)); },
  };
  const sent: Email[] = [];
  let failures = opts.failSends ?? 0;
  const mail: MailDeps = {
    claims,
    send: async (e) => {
      if (failures-- > 0) throw new Error("Resend HTTP 500");
      sent.push(e);
      return { sent: true };
    },
    subOf: async () => current ?? { tier: opts.tier ?? "pro", stripe_subscription_id: null },
    unsubscribe: (u) => `${SITE}/api/unsubscribe?t=tok-${u}`,
  };
  return { mail, sent, claimed };
}

const U = "11111111-1111-1111-1111-111111111111";
const billing = { userForCustomer: async (c: string) => (c === "cus_1" ? U : null), emailFor: async () => "a@x.test" };
const ev = (type: string, object: object, previous_attributes?: object, id = `evt_${type}`) =>
  ({ id, object: "event", type, data: { object, ...(previous_attributes ? { previous_attributes } : {}) } }) as unknown as Stripe.Event;
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
const noFunnel = { db: () => null };

describe("sendOnce", () => {
  it("claims before sending; a failed send releases the claim so a later trigger delivers exactly one", async () => {
    const { mail, sent, claimed } = fakeMail({ failSends: 1 });
    const build = () => welcomeEmail("a@x.test", `${SITE}/api/unsubscribe?t=x`);
    await expect(sendOnce(mail, U, "welcome", "", build)).rejects.toThrow("Resend HTTP 500");
    expect(claimed.size).toBe(0);
    expect(await sendOnce(mail, U, "welcome", "", build)).toBe(true);
    expect(await sendOnce(mail, U, "welcome", "", build)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("Resend not configured ({ sent: false }): releases the claim, nothing recorded as sent", async () => {
    const { mail, claimed } = fakeMail();
    const off = { ...mail, send: async () => ({ sent: false }) };
    expect(await sendOnce(off, U, "receipt", "", () => welcomeEmail("a", "b"))).toBe(false);
    expect(claimed.size).toBe(0);
  });
});

describe("triggers", () => {
  it("welcome: first sign-in of a new account, once (two devices, two sign-ins); not for an old account", async () => {
    const { mail, sent } = fakeMail();
    const d = { mail, funnel: noFunnel, now: () => NOW };
    await onFirstSignIn({ id: U, email: "a@x.test", created_at: new Date(NOW - 60_000).toISOString() }, d);
    await onFirstSignIn({ id: U, email: "a@x.test", created_at: new Date(NOW - 60_000).toISOString() }, d);
    await onFirstSignIn({ id: "old", email: "o@x.test", created_at: "2025-01-01T00:00:00Z" }, d);
    expect(sent.map((e) => [e.to, e.subject])).toEqual([["a@x.test", "Welcome to Kismet: how to read a bet card"]]);
    expect(sent[0]!.unsubscribeUrl).toBe(`${SITE}/api/unsubscribe?t=tok-${U}`);
  });

  it("welcome: a sign-in never fails because email did (Resend down, claim table missing)", async () => {
    const err = quiet();
    const { mail } = fakeMail({ failSends: 5 });
    const broken: MailDeps = { ...mail, claims: { claim: async () => { throw new Error('relation "lifecycle_emails" does not exist'); }, release: async () => {} } };
    for (const m of [mail, broken]) {
      await expect(onFirstSignIn({ id: U, email: "a@x.test", created_at: new Date(NOW).toISOString() }, { mail: m, funnel: noFunnel, now: () => NOW })).resolves.toBeUndefined();
    }
    err.mockRestore();
  });

  it("receipt: the first invoice with money only; Stripe retries and renewals send nothing more", async () => {
    const { mail, sent } = fakeMail({ tier: "premium" });
    const d = { mail, funnel: noFunnel, now: () => NOW };
    const inv = (id: string, amount_paid: number) => ({ id, customer: "cus_1", amount_paid, currency: "usd", number: `KIS-${id}`, status_transitions: { paid_at: NOW / 1000 } });
    await afterBillingEvent(ev("invoice.paid", inv("in_0", 0)), billing, d);       // the trial's $0 invoice
    await afterBillingEvent(ev("invoice.paid", inv("in_1", 900)), billing, d);
    await afterBillingEvent(ev("invoice.paid", inv("in_1", 900)), billing, d);     // retry
    await afterBillingEvent(ev("invoice.paid", inv("in_2", 900)), billing, d);     // renewal
    await afterBillingEvent(ev("invoice.paid", { ...inv("in_9", 900), customer: "cus_unknown" }), billing, d);
    expect(sent.map((e) => e.subject)).toEqual(["Receipt: $9.00 for Kismet Premium"]);
    expect(sent[0]!.text).toContain("Invoice KIS-in_1");
    expect(sent[0]!.unsubscribeUrl).toBeUndefined();
  });

  it("receipt: a failed send leaves no claim, so the next qualifying invoice event sends it, once", async () => {
    const err = quiet();
    const { mail, sent } = fakeMail({ failSends: 1 });
    const d = { mail, funnel: noFunnel, now: () => NOW };
    const e = ev("invoice.paid", { id: "in_1", customer: "cus_1", amount_paid: 900, currency: "usd" });
    await afterBillingEvent(e, billing, d);
    await afterBillingEvent(e, billing, d);
    await afterBillingEvent(e, billing, d);
    expect(sent).toHaveLength(1);
    err.mockRestore();
  });

  it("cancel: when cancel_at_period_end turns on, then not again when the subscription ends at period end", async () => {
    const { mail, sent } = fakeMail();
    const d = { mail, funnel: noFunnel, now: () => NOW };
    const end = Math.floor((NOW + 10 * DAY) / 1000);
    const sub = { id: "sub_1", customer: "cus_1", status: "active", metadata: {}, cancel_at_period_end: true, cancel_at: end, current_period_end: end, items: { data: [{ price: { id: "price_x", unit_amount: 900, metadata: { tier: "pro" } } }] } };
    await afterBillingEvent(ev("customer.subscription.updated", { ...sub, cancel_at_period_end: false, cancel_at: null }, { metadata: {} }), billing, d);   // unrelated update
    await afterBillingEvent(ev("customer.subscription.updated", sub, { cancel_at_period_end: false, cancel_at: null }), billing, d);
    await afterBillingEvent(ev("customer.subscription.updated", sub, { cancel_at_period_end: false, cancel_at: null }), billing, d);   // retry
    await afterBillingEvent(ev("customer.subscription.updated", sub, { items: {} }), billing, d);   // later update, still canceling
    await afterBillingEvent(ev("customer.subscription.deleted", { ...sub, status: "canceled" }), billing, d);
    expect(sent.map((e) => e.subject)).toEqual(["Your Kismet Pro plan is canceled"]);
    expect(sent[0]!.text).toContain("You keep Pro until Mon, Nov 30, 2026");
    expect(sent[0]!.unsubscribeUrl).toBeUndefined();
  });

  it("cancel: also a cancel_at date set in the portal, and an immediate end", async () => {
    const { mail, sent } = fakeMail();
    const d = { mail, funnel: noFunnel, now: () => NOW };
    const at = Math.floor((NOW + 3 * DAY) / 1000);
    await afterBillingEvent(ev("customer.subscription.updated", { id: "sub_2", customer: "cus_1", status: "active", metadata: {}, cancel_at_period_end: false, cancel_at: at, items: { data: [] } }, { cancel_at: null }), billing, d);
    await afterBillingEvent(ev("customer.subscription.deleted", { id: "sub_3", customer: "cus_1", status: "canceled", metadata: { user_id: U }, cancel_at_period_end: false, cancel_at: null, items: { data: [] } }), billing, d);
    expect(sent.map((e) => e.subject)).toEqual(["Your Kismet Pro plan is canceled", "Your Kismet Pro plan has ended"]);
  });
});

describe("cancel vs upgrade", () => {
  it("an old Pro ending (or set to cancel) while the user pays for Premium sends no cancel email", async () => {
    const { mail, sent } = fakeMail({ current: { tier: "premium", stripe_subscription_id: "sub_premium" } });
    const d = { mail, funnel: noFunnel, now: () => NOW };
    const end = Math.floor((NOW + 5 * DAY) / 1000);
    const old = { id: "sub_pro", customer: "cus_1", status: "active", metadata: {}, cancel_at_period_end: true, cancel_at: end, current_period_end: end, items: { data: [] } };
    await afterBillingEvent(ev("customer.subscription.updated", old, { cancel_at_period_end: false }), billing, d);
    await afterBillingEvent(ev("customer.subscription.deleted", { ...old, status: "canceled" }), billing, d);
    expect(sent).toEqual([]);
  });

  it("the current subscription ending still sends one (row already moved to free)", async () => {
    const { mail, sent } = fakeMail({ current: { tier: "free", stripe_subscription_id: "sub_premium" } });
    await afterBillingEvent(ev("customer.subscription.deleted", { id: "sub_premium", customer: "cus_1", status: "canceled", metadata: {}, cancel_at_period_end: false, cancel_at: null, items: { data: [] } }), billing, { mail, funnel: noFunnel, now: () => NOW });
    expect(sent.map((e) => e.subject)).toEqual(["Your Kismet Pro plan has ended"]);
  });
});

describe("trial-ending cron", () => {
  const row = (over: Partial<TrialRow>): TrialRow => ({
    user_id: U, stripe_subscription_id: "sub_t", tier: "pro", status: "trialing",
    current_period_end: new Date(NOW + 2 * DAY).toISOString(), cancel_at_period_end: false, ...over,
  });

  it("due: trialing, ends within 2.5 days and later than now, not already canceling", () => {
    const rows = [
      row({ stripe_subscription_id: "due_2d" }),
      row({ stripe_subscription_id: "due_1d", current_period_end: new Date(NOW + DAY).toISOString() }),
      row({ stripe_subscription_id: "too_early", current_period_end: new Date(NOW + 3 * DAY).toISOString() }),
      row({ stripe_subscription_id: "ended", current_period_end: new Date(NOW - 1000).toISOString() }),
      row({ stripe_subscription_id: "canceling", cancel_at_period_end: true }),
      row({ stripe_subscription_id: "active", status: "active" }),
      row({ stripe_subscription_id: null }),
      row({ stripe_subscription_id: "no_date", current_period_end: null }),
    ];
    expect(trialsDue(rows, NOW).map((r) => r.stripe_subscription_id)).toEqual(["due_2d", "due_1d"]);
  });

  it("sends each trial's reminder once across daily runs, retries after a failure, and a new trial gets its own", async () => {
    const err = quiet();
    const { mail, sent } = fakeMail({ failSends: 1 });
    const rows = [row({ user_id: "u1", stripe_subscription_id: "sub_a" }), row({ user_id: "u2", stripe_subscription_id: "sub_b", tier: "premium" })];
    const source = { trialing: async () => rows, emailFor: async (u: string) => `${u}@x.test` };
    expect(await runTrialReminders(source, mail, NOW)).toEqual({ due: 2, sent: 1, failed: 1 });   // Resend fails once
    expect(await runTrialReminders(source, mail, NOW + 3_600_000)).toEqual({ due: 2, sent: 1, failed: 0 });
    expect(await runTrialReminders(source, mail, NOW + 7_200_000)).toEqual({ due: 2, sent: 0, failed: 0 });
    expect(sent.map((e) => [e.to, e.subject]).sort()).toEqual([["u1@x.test", "Your Kismet Pro trial ends in 2 days"], ["u2@x.test", "Your Kismet Premium trial ends in 2 days"]]);
    rows.push(row({ user_id: "u1", stripe_subscription_id: "sub_c" }));   // a later trial on another subscription
    expect((await runTrialReminders(source, mail, NOW)).sent).toBe(1);
    err.mockRestore();
  });

  it("GET /api/lifecycle/run needs the cron secret; with it and no Supabase it answers ran:false", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const call = (auth?: string) => lifecycleGet(new Request("http://t/api/lifecycle/run", { headers: auth ? { authorization: auth } : {} }));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    const ok = await call("Bearer s3cret");
    expect(ok.status).toBe(200);
    expect((await ok.json()).ran).toBe(false);
  });
});

describe("invoice.paid before the customer is linked (no-trial checkout, Payment Links)", () => {
  it("a charge for an unlinked customer → 500 so Stripe retries, not marked seen; after linking the retry is accepted", async () => {
    const SECRET = "whsec_t";
    const seen = new Set<string>();
    const customers = new Map<string, string>();
    const db = {
      seen: async (id: string) => seen.has(id), markSeen: async (id: string) => { seen.add(id); },
      userForCustomer: async (c: string) => customers.get(c) ?? null, emailFor: async () => "a@x.test",
    } as unknown as BillingDb;
    const signed = (id: string, amount_paid: number) => {
      const payload = JSON.stringify({ id, object: "event", type: "invoice.paid", data: { object: { id: "in_1", object: "invoice", customer: "cus_new", amount_paid, currency: "usd" } } });
      return new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) } });
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await handleWebhook(signed("evt_zero", 0), db, null, SECRET)).status).toBe(200);   // $0 trial invoice: nothing to retry for
    expect((await handleWebhook(signed("evt_paid", 900), db, null, SECRET)).status).toBe(500);
    expect(seen.has("evt_paid")).toBe(false);
    customers.set("cus_new", U);   // checkout.session.completed / subscription.created arrives
    expect((await handleWebhook(signed("evt_paid", 900), db, null, SECRET)).status).toBe(200);
    expect(seen.has("evt_paid")).toBe(true);
    err.mockRestore();
  });
});
