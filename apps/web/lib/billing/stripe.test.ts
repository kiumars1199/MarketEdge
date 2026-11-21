// T-43 webhook: forged / stale signatures rejected, duplicates ignored, tier mapping from price.
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientRef, handleWebhook, tierFromPrice, verifyClientRef, type BillingDb, type SubscriptionRow } from "./stripe";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ sent: true })), siteUrl: () => "http://test", unsubscribeUrl: () => "http://test/u" }));

const SECRET = "whsec_test_secret";
const U = "user-1";
const REF = clientRef(U, Date.now(), SECRET)!;

function memDb() {
  const events = new Set<string>();
  const customers = new Map<string, string>();
  const subs = new Map<string, Partial<SubscriptionRow>>();
  const db: BillingDb & { subs: typeof subs } = {
    subs,
    seen: async (id) => events.has(id),
    markSeen: async (id) => { events.add(id); },
    linkCustomer: async (u, c) => { customers.set(c, u); subs.set(u, { ...subs.get(u), stripe_customer_id: c }); },
    userForCustomer: async (c) => customers.get(c) ?? null,
    customerOf: async (u) => ({ customer: subs.get(u)?.stripe_customer_id ?? null, status: subs.get(u)?.status ?? null }),
    emailFor: async () => "a@x.test",
    upsertSubscription: async (u, row) => { subs.set(u, { ...subs.get(u), ...row }); },
  };
  return db;
}

const sub = (status: string, price: Partial<Stripe.Price>, extra: object = {}) => ({
  id: "sub_1", object: "subscription", customer: "cus_1", status, cancel_at_period_end: false, trial_start: null,
  metadata: {}, items: { data: [{ price: { id: "price_x", unit_amount: null, metadata: {}, ...price }, current_period_end: 1_900_000_000 }] },
  ...extra,
});

function signed(event: object, opts: { secret?: string; timestamp?: number } = {}) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? SECRET, timestamp: opts.timestamp });
  return new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } });
}

const ev = (id: string, type: string, object: object) => ({ id, object: "event", type, data: { object } });

beforeEach(() => {
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
  vi.stubEnv("STRIPE_PRICE_PREMIUM_YEARLY", "price_prem_y");
});

describe("stripe webhook", () => {
  it("rejects a forged signature, a missing one and an old timestamp", async () => {
    const db = memDb();
    const e = ev("evt_1", "customer.subscription.updated", sub("active", { id: "price_pro_m" }, { metadata: { user_id: U } }));
    expect((await handleWebhook(signed(e, { secret: "whsec_wrong" }), db, null, SECRET)).status).toBe(400);
    expect((await handleWebhook(new Request("http://x", { method: "POST", body: "{}" }), db, null, SECRET)).status).toBe(400);
    const old = Math.floor(Date.now() / 1000) - 600;
    expect((await handleWebhook(signed(e, { timestamp: old }), db, null, SECRET)).status).toBe(400);
    // tampered body with a valid header for different bytes
    const good = signed(e);
    const tampered = new Request(good.url, { method: "POST", body: JSON.stringify({ ...e, id: "evt_evil" }), headers: good.headers });
    expect((await handleWebhook(tampered, db, null, SECRET)).status).toBe(400);
    expect(db.subs.size).toBe(0);
  });

  it("links the customer on checkout, then sets the tier from subscription events", async () => {
    const db = memDb();
    const done = ev("evt_c", "checkout.session.completed", { id: "cs_1", object: "checkout.session", client_reference_id: REF, customer: "cus_1", subscription: null });
    expect((await handleWebhook(signed(done), db, null, SECRET)).status).toBe(200);
    const created = ev("evt_s", "customer.subscription.created", sub("trialing", { id: "price_pro_m" }, { trial_start: 1_800_000_000 }));
    expect((await handleWebhook(signed(created), db, null, SECRET)).status).toBe(200);
    expect(db.subs.get(U)).toMatchObject({ tier: "pro", status: "trialing", stripe_customer_id: "cus_1", trialed_at: expect.any(String) });
  });

  it("ignores a duplicate event id", async () => {
    const db = memDb();
    const e = ev("evt_dup", "customer.subscription.updated", sub("active", { id: "price_prem_y" }, { metadata: { user_id: U } }));
    await handleWebhook(signed(e), db, null, SECRET);
    db.subs.set(U, { tier: "free" });  // if processed again it would flip back to premium
    const res = await handleWebhook(signed(e), db, null, SECRET);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(db.subs.get(U)?.tier).toBe("free");
  });

  it("downgrades to free when the subscription is canceled or unpaid", async () => {
    const db = memDb();
    await handleWebhook(signed(ev("e1", "customer.subscription.deleted", sub("canceled", { id: "price_pro_m" }, { metadata: { user_id: U } }))), db, null, SECRET);
    expect(db.subs.get(U)?.tier).toBe("free");
    await handleWebhook(signed(ev("e2", "customer.subscription.updated", sub("past_due", { id: "price_pro_m" }, { metadata: { user_id: U } }))), db, null, SECRET);
    expect(db.subs.get(U)?.tier).toBe("pro");   // past_due keeps access while Stripe retries the card
    await handleWebhook(signed(ev("e3", "customer.subscription.updated", sub("unpaid", { id: "price_pro_m" }, { metadata: { user_id: U } }))), db, null, SECRET);
    expect(db.subs.get(U)?.tier).toBe("free");
  });

  it("asks Stripe to retry when the customer isn't linked yet (and doesn't mark it seen)", async () => {
    const db = memDb();
    const e = ev("evt_early", "customer.subscription.created", sub("active", { id: "price_pro_m" }));
    expect((await handleWebhook(signed(e), db, null, SECRET)).status).toBe(500);
    expect(await db.seen("evt_early")).toBe(false);
  });
});

describe("RT-05 client_reference_id is signed; a raw or edited id can't take over another user's billing", () => {
  const done = (id: string, ref: string, customer: string) =>
    ev(id, "checkout.session.completed", { id: "cs_" + id, object: "checkout.session", client_reference_id: ref, customer, subscription: null });

  it("a raw user id (an edited Payment Link) links nothing", async () => {
    const db = memDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await handleWebhook(signed(done("evt_raw", U, "cus_attacker")), db, null, SECRET)).status).toBe(200);
    expect(await db.userForCustomer("cus_attacker")).toBeNull();
    expect(db.subs.get(U)).toBeUndefined();
  });

  it("tampered, expired or other-secret references are refused", () => {
    const now = Date.now();
    const [, exp, mac] = REF.split("_");
    expect(verifyClientRef(REF, now, SECRET)).toBe(U);
    expect(verifyClientRef(`victim-2_${exp}_${mac}`, now, SECRET)).toBeNull();
    expect(verifyClientRef(REF, now + 6 * 86_400_000, SECRET)).toBe(U);   // RT3-09: a Payment Link tab paid days later still links
    expect(verifyClientRef(REF, now + 7 * 86_400_000 + 3_600_000, SECRET)).toBeNull();
    expect(verifyClientRef(clientRef(U, now, "whsec_other"), now, SECRET)).toBeNull();
    expect(REF).toMatch(/^[A-Za-z0-9_-]{1,200}$/);   // what Stripe accepts in client_reference_id
  });

  it("never re-links a user who already pays through another customer", async () => {
    const db = memDb();
    await db.linkCustomer(U, "cus_victim");
    await db.upsertSubscription(U, { stripe_customer_id: "cus_victim", stripe_subscription_id: "sub_v", tier: "pro", status: "active", current_period_end: null, cancel_at_period_end: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handleWebhook(signed(done("evt_relink", REF, "cus_other")), db, null, SECRET);
    expect(db.subs.get(U)).toMatchObject({ stripe_customer_id: "cus_victim", tier: "pro" });
    expect(await db.userForCustomer("cus_other")).toBeNull();
  });
});

describe("tierFromPrice", () => {
  it("maps env price ids, metadata, then Payment Link amounts", () => {
    expect(tierFromPrice({ id: "price_pro_m" })).toBe("pro");
    expect(tierFromPrice({ id: "price_prem_y" })).toBe("premium");
    expect(tierFromPrice({ id: "p", metadata: { tier: "premium" } })).toBe("premium");
    expect(tierFromPrice({ id: "p", unit_amount: 1199 })).toBe("pro");
    expect(tierFromPrice({ id: "p", unit_amount: 9999 })).toBe("pro");
    expect(tierFromPrice({ id: "p", unit_amount: 1999 })).toBe("premium");
    expect(tierFromPrice({ id: "p", unit_amount: 16999 })).toBe("premium");
    expect(tierFromPrice({ id: "p", unit_amount: 1900 })).toBeNull();   // the old $19 price
    expect(tierFromPrice({ id: "p", unit_amount: 500 })).toBeNull();
    expect(tierFromPrice(null)).toBeNull();
  });
});

// Out-of-order events: Stripe doesn't guarantee delivery order, so an older "premium" event arriving after a newer
// "pro" one used to leave the user on premium. Every subscription event now sets the tier from the subscription as
// Stripe holds it now.
describe("stripe webhook: tier from the current subscription", () => {
  it("an older event delivered late can't overwrite the current plan", async () => {
    const db = memDb();
    const current = sub("active", { id: "price_pro_m" }, { metadata: { user_id: U } });
    const list = vi.fn(async () => ({ data: [current] }));
    const stripe = { subscriptions: { list, retrieve: vi.fn(async () => current) } } as unknown as Stripe;
    const newer = ev("evt_new", "customer.subscription.updated", current);
    const older = ev("evt_old", "customer.subscription.updated", sub("active", { id: "price_prem_y" }, { metadata: { user_id: U } }));
    expect((await handleWebhook(signed(newer), db, stripe, SECRET)).status).toBe(200);
    expect((await handleWebhook(signed(older), db, stripe, SECRET)).status).toBe(200);
    expect(db.subs.get(U)?.tier).toBe("pro");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
  });

  it("a deleted subscription Stripe no longer lists falls back to the event (ends the plan)", async () => {
    const db = memDb();
    const stripe = { subscriptions: { list: vi.fn(async () => ({ data: [] })) } } as unknown as Stripe;
    const deleted = ev("evt_del", "customer.subscription.deleted", sub("canceled", { id: "price_pro_m" }, { metadata: { user_id: U } }));
    expect((await handleWebhook(signed(deleted), db, stripe, SECRET)).status).toBe(200);
    expect(db.subs.get(U)?.tier).toBe("free");
  });

  // Audit run 8 fail 2: the user canceled Pro (sub_1), then bought Premium (sub_2). A late event for sub_1 must not
  // drop them to free, and with two live subscriptions the user gets the higher plan they are paying for.
  it("a late event for the user's earlier subscription can't override the one they pay for now", async () => {
    const db = memDb();
    const old = sub("canceled", { id: "price_pro_m" }, { id: "sub_1", metadata: { user_id: U } });
    const now = sub("active", { id: "price_prem_y" }, { id: "sub_2", metadata: { user_id: U } });
    const stripe = { subscriptions: { list: vi.fn(async () => ({ data: [now, old] })) } } as unknown as Stripe;
    expect((await handleWebhook(signed(ev("evt_b", "customer.subscription.created", now)), db, stripe, SECRET)).status).toBe(200);
    expect((await handleWebhook(signed(ev("evt_late", "customer.subscription.updated", old)), db, stripe, SECRET)).status).toBe(200);
    expect(db.subs.get(U)).toMatchObject({ tier: "premium", stripe_subscription_id: "sub_2" });
    const both = { subscriptions: { list: vi.fn(async () => ({ data: [sub("active", { id: "price_pro_m" }, { id: "sub_1", metadata: { user_id: U } }), now] })) } } as unknown as Stripe;
    expect((await handleWebhook(signed(ev("evt_c", "customer.subscription.updated", old)), db, both, SECRET)).status).toBe(200);
    expect(db.subs.get(U)?.tier).toBe("premium");
  });

  // Audit run 10 fail 1: Stripe retries sub_1's original checkout event after the user moved to Premium (sub_2).
  it("a late checkout event for a canceled subscription leaves the user on the plan they pay for", async () => {
    const db = memDb();
    const old = sub("canceled", { id: "price_pro_m" }, { id: "sub_1", metadata: { user_id: U } });
    const now = sub("active", { id: "price_prem_y" }, { id: "sub_2", metadata: { user_id: U } });
    const stripe = { subscriptions: { list: vi.fn(async () => ({ data: [now, old] })), retrieve: vi.fn(async () => old) } } as unknown as Stripe;
    expect((await handleWebhook(signed(ev("evt_b", "customer.subscription.created", now)), db, stripe, SECRET)).status).toBe(200);
    const late = ev("evt_late_c", "checkout.session.completed", { id: "cs_1", object: "checkout.session", client_reference_id: REF, customer: "cus_1", subscription: "sub_1" });
    expect((await handleWebhook(signed(late), db, stripe, SECRET)).status).toBe(200);
    expect(db.subs.get(U)).toMatchObject({ tier: "premium", stripe_subscription_id: "sub_2", status: "active" });
  });
});
