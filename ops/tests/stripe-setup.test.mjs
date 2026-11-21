// Runs ops/stripe-setup.mjs through the real Stripe SDK against a small in-process Stripe stand-in (products, prices,
// webhook endpoints, portal configurations). The app's own e2e mock doesn't serve those routes. Nothing leaves the machine.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseEnv } from "node:util";
import { after, before, test } from "node:test";
import { webhookEvents } from "../stripe-setup.mjs";
import { PROD_ENV, ROOT, WEB } from "../lib.mjs";

/** Stripe form encoding (a[b][0]=x) → nested objects/arrays. */
function decode(params) {
  const out = {};
  for (const [k, raw] of params) {
    const path = k.replace(/\]/g, "").split("[");
    const v = raw === "true" ? true : raw === "false" ? false : /^\d+$/.test(raw) && /amount/.test(k) ? Number(raw) : raw;
    let o = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) { o[p] = v; return; }
      o[p] ??= /^\d+$/.test(path[i + 1]) ? [] : {};
      o = o[p];
    });
  }
  return out;
}

const state = { products: [], prices: [], hooks: [], portals: [], writes: [] };
let n = 0;
const id = (p) => `${p}_mock${++n}`;
const list = (data) => ({ object: "list", data, has_more: false, url: "/v1/x" });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  const q = decode(req.method === "GET" ? url.searchParams : new URLSearchParams(body));
  const send = (o, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const [, , kind, sub, oid] = url.pathname.split("/");   // /v1/<kind>[/<id>] or /v1/billing_portal/configurations[/<id>]
  if (req.method === "POST") state.writes.push(`${url.pathname}`);
  if (kind === "products") {
    if (req.method === "GET") return send(list(state.products));
    const p = { id: id("prod"), object: "product", active: true, ...q };
    state.products.push(p);
    return send(p);
  }
  if (kind === "prices") {
    if (req.method === "GET") return send(list(state.prices.filter((p) => p.active && (!q.lookup_keys || q.lookup_keys.includes(p.lookup_key)))));
    if (q.transfer_lookup_key) for (const p of state.prices) if (p.lookup_key === q.lookup_key) p.lookup_key = null;
    const { transfer_lookup_key, ...rest } = q;
    const p = { id: id("price"), object: "price", active: true, ...rest };
    state.prices.push(p);
    return send(p);
  }
  if (kind === "webhook_endpoints") {
    if (req.method === "GET") return send(list(state.hooks));
    if (sub) { const h = state.hooks.find((x) => x.id === sub); Object.assign(h, q); return send(h); }
    const h = { id: id("we"), object: "webhook_endpoint", status: "enabled", ...q, secret: "whsec_mocksecret0123456789" };
    state.hooks.push(h);
    return send(h);
  }
  if (kind === "billing_portal" && sub === "configurations") {
    if (req.method === "GET") return send(list(state.portals.filter((c) => !q.is_default || c.is_default)));
    if (oid) { const c = state.portals.find((x) => x.id === oid); Object.assign(c, q); return send(c); }
    const c = { id: id("bpc"), object: "billing_portal.configuration", is_default: !state.portals.length, ...q };
    state.portals.push(c);
    return send(c);
  }
  send({ error: { type: "invalid_request_error", message: `mock: ${req.method} ${url.pathname}` } }, 404);
});

let base;
before(async () => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

const envFile = join(WEB, `.env.stripe-test-${process.pid}`);   // gitignored (.env*)
const run = (...a) => promisify(execFile)("node", [join(ROOT, "ops/stripe-setup.mjs"), "--env", envFile, "--domain", "kismetodds.example", ...a], {
  env: { ...process.env, STRIPE_SECRET_KEY: "sk_test_FAKEFAKEFAKEFAKE", STRIPE_API_BASE: base },
}).then((r) => r.stdout);

test("events come from the webhook handler", () => {
  assert.deepEqual(webhookEvents(), ["checkout.session.completed", "customer.subscription.created",
    "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed", "invoice.paid"]);
});

test("dry run reads only; --yes creates everything once; a second --yes changes nothing", async () => {
  writeFileSync(envFile, "STRIPE_PRICE_PRO_MONTHLY=\nSTRIPE_WEBHOOK_SECRET=\n");
  try {
    const dry = await run();
    assert.match(dry, /would create: product Kismet Pro/);
    assert.deepEqual(state.writes, [], "dry run made no POST");

    const first = await run("--yes");
    assert.equal(state.products.length, 2);
    assert.deepEqual(state.prices.map((p) => [p.lookup_key, p.unit_amount, p.recurring.interval, p.metadata.tier]), [
      ["kismet_pro_monthly", 1199, "month", "pro"], ["kismet_pro_yearly", 9999, "year", "pro"],
      ["kismet_premium_monthly", 1999, "month", "premium"], ["kismet_premium_yearly", 16999, "year", "premium"]]);
    assert.equal(state.hooks[0].url, "https://kismetodds.example/api/stripe/webhook");
    assert.deepEqual(state.hooks[0].enabled_events, webhookEvents());
    const portal = state.portals[0].features;
    assert.equal(portal.subscription_cancel.mode, "at_period_end");
    assert.deepEqual(portal.subscription_update.products.map((p) => p.prices.length), [2, 2]);
    assert.doesNotMatch(first, /whsec_mocksecret/, "the webhook secret is written to the file, not printed");
    const env = parseEnv(readFileSync(envFile, "utf8"));
    assert.equal(env.STRIPE_WEBHOOK_SECRET, "whsec_mocksecret0123456789");
    assert.equal(env.STRIPE_PRICE_PRO_MONTHLY, state.prices[0].id);
    assert.equal(env.STRIPE_PRICE_PREMIUM_YEARLY, state.prices[3].id, "missing keys appended");

    const writes = state.writes.length;
    const second = await run("--yes");
    assert.equal(state.writes.length, writes, `second run wrote: ${state.writes.slice(writes)}`);
    assert.doesNotMatch(second, /^ {2}- (create|update)/m);

    state.hooks[0].enabled_events = ["checkout.session.completed"];   // drift is repaired
    assert.match(await run("--yes"), /update: webhook/);
    assert.deepEqual(state.hooks[0].enabled_events, webhookEvents());
  } finally {
    rmSync(envFile, { force: true });
  }
});

test("a live key needs --live", async () => {
  writeFileSync(envFile, "");
  try {
    await assert.rejects(promisify(execFile)("node", [join(ROOT, "ops/stripe-setup.mjs"), "--env", envFile, "--domain", "x.example", "--yes"], {
      env: { ...process.env, STRIPE_SECRET_KEY: "sk_live_FAKEFAKEFAKEFAKE" },
    }), /LIVE key/);
  } finally {
    rmSync(envFile, { force: true });
  }
});

// RT3-08: with no env file the secret was printed in full (CI logs, scrollback). Always masked now; an existing env
// file is also forced to 0600 (writeFileSync's mode only applies when it creates the file).
test("the webhook secret is never printed; the env file ends up 0600", async (t) => {
  if (existsSync(PROD_ENV) || existsSync(join(WEB, ".env.local"))) return t.skip("an env file exists: the no-file path can't run here");
  state.hooks.length = 0;   // a fresh endpoint, so a new secret is issued
  const out = await promisify(execFile)("node", [join(ROOT, "ops/stripe-setup.mjs"), "--domain", "kismetodds.example", "--yes"], {
    env: { ...process.env, STRIPE_SECRET_KEY: "sk_test_FAKEFAKEFAKEFAKE", STRIPE_API_BASE: base },
  }).then((r) => r.stdout);
  assert.doesNotMatch(out, /whsec_mocksecret/);
  assert.match(out, /Signing secret/);

  writeFileSync(envFile, "STRIPE_WEBHOOK_SECRET=\n", { mode: 0o644 });
  try {
    state.hooks.length = 0;
    await run("--yes");
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
  } finally {
    rmSync(envFile, { force: true });
  }
});
