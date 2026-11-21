#!/usr/bin/env node
// Stripe account setup for Checkout mode (ops/ship.md step 7). Idempotent: finds what exists, creates or fixes only
// what's missing, and prints the env values to paste. Dry run unless --yes (a dry run with a key only reads).
//
//   node ops/stripe-setup.mjs [--env apps/web/.env.prod] [--domain kismetodds.com] [--yes] [--live]
//
// Creates, from the app's own config (never invented):
//   - products "Kismet Pro" / "Kismet Premium" (found again by metadata.kismet_tier)
//   - 4 recurring USD prices from config/site.json prices_usd (found by lookup_key kismet_<key>; metadata.tier set)
//   - the webhook endpoint https://<domain>/api/stripe/webhook with exactly the events lib/billing/stripe.ts handles
//   - the default Customer Portal configuration: cancel at period end, switch between the 4 prices, update card, invoices
// Key: STRIPE_SECRET_KEY from the environment, else the env file. Needs a secret key (or a restricted key with write on
// products, prices, webhook endpoints and portal configurations). A live key needs --live as well as --yes.
// With --yes and an env file, empty STRIPE_PRICE_* / STRIPE_WEBHOOK_SECRET lines are filled in; set values are never replaced.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv, mask, parseArgs, PRICE_KEYS, rel, setIfEmpty, SITE_JSON, WEB } from "./lib.mjs";

const Stripe = createRequire(resolve(WEB, "package.json"))("stripe");

/** The events the webhook handler acts on, read from its source so the two can't drift. */
export const webhookEvents = (src = readFileSync(resolve(WEB, "lib/billing/stripe.ts"), "utf8")) =>
  [...src.slice(src.indexOf("export async function handleEvent")).matchAll(/case "([a-z_]+\.[a-z_.]+)":/g)].map((m) => m[1]);

export const PRICE_ENV = Object.fromEntries(PRICE_KEYS.map((k) => [k, `STRIPE_PRICE_${k.toUpperCase()}`]));
const TIERS = { pro: "Kismet Pro", premium: "Kismet Premium" };

/** What the account should hold, from config/site.json. */
export function desired(site, origin) {
  return {
    prices: PRICE_KEYS.map((key) => ({
      key, tier: key.split("_")[0], lookup_key: `kismet_${key}`, interval: key.endsWith("monthly") ? "month" : "year",
      unit_amount: Math.round(Number(site.prices_usd[key]) * 100),
    })),
    webhookUrl: `${origin}/api/stripe/webhook`,
    portal: (products) => ({
      business_profile: { privacy_policy_url: `${origin}/privacy`, terms_of_service_url: `${origin}/terms` },
      default_return_url: `${origin}/account`,
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products },
      },
    }),
  };
}

const sameEvents = (a, b) => [...a].sort().join() === [...b].sort().join();
/** The portal fields we set, normalised so an existing configuration can be compared with the wanted one. */
const portalShape = (c) => JSON.stringify({
  p: c.business_profile?.privacy_policy_url, t: c.business_profile?.terms_of_service_url, r: c.default_return_url,
  ih: !!c.features?.invoice_history?.enabled, pm: !!c.features?.payment_method_update?.enabled,
  sc: [!!c.features?.subscription_cancel?.enabled, c.features?.subscription_cancel?.mode],
  su: [!!c.features?.subscription_update?.enabled, [...(c.features?.subscription_update?.default_allowed_updates ?? [])].sort(),
    (c.features?.subscription_update?.products ?? []).map((p) => `${p.product}:${[...p.prices].sort()}`).sort()],
});

/** Brings the account in line. apply=false only reads. Returns { steps, env, webhookSecret }. */
export async function setup(stripe, { site, origin, events, apply }) {
  const want = desired(site, origin);
  const steps = [];
  const step = (verb, what) => steps.push(`${apply ? verb : `would ${verb}`}: ${what}`);
  const keep = (what) => steps.push(`ok: ${what}`);

  const products = {};
  const existing = [];
  for await (const p of stripe.products.list({ limit: 100, active: true })) existing.push(p);
  for (const [tier, name] of Object.entries(TIERS)) {
    const found = existing.find((p) => p.metadata?.kismet_tier === tier);
    if (found) { keep(`product ${name} (${found.id})`); products[tier] = found.id; continue; }
    step("create", `product ${name}`);
    products[tier] = apply ? (await stripe.products.create({ name, metadata: { kismet_tier: tier } })).id : `<new ${tier} product>`;
  }

  const env = {};
  const byKey = {};
  for (const p of (await stripe.prices.list({ lookup_keys: want.prices.map((x) => x.lookup_key), active: true, limit: 10 })).data) byKey[p.lookup_key] = p;
  for (const w of want.prices) {
    const p = byKey[w.lookup_key];
    const label = `price ${w.key} $${(w.unit_amount / 100).toFixed(2)}/${w.interval}`;
    if (p && p.unit_amount === w.unit_amount && p.currency === "usd" && p.recurring?.interval === w.interval && p.product === products[w.tier]) {
      keep(`${label} (${p.id})`);
      env[PRICE_ENV[w.key]] = p.id;
      continue;
    }
    step("create", `${label}${p ? ` (replaces ${p.id}: amount, interval or product differ; existing subscribers keep the old price)` : ""}`);
    env[PRICE_ENV[w.key]] = apply
      ? (await stripe.prices.create({
        product: products[w.tier], currency: "usd", unit_amount: w.unit_amount, recurring: { interval: w.interval },
        lookup_key: w.lookup_key, transfer_lookup_key: !!p, metadata: { tier: w.tier },
      })).id
      : `<new ${w.key} price>`;
  }

  let webhookSecret = null;
  const hooks = [];
  for await (const h of stripe.webhookEndpoints.list({ limit: 100 })) hooks.push(h);
  const hook = hooks.find((h) => h.url === want.webhookUrl);
  if (!hook) {
    step("create", `webhook ${want.webhookUrl} for ${events.join(", ")}`);
    if (apply) {
      webhookSecret = (await stripe.webhookEndpoints.create({
        url: want.webhookUrl, enabled_events: events, api_version: Stripe.API_VERSION, description: "Kismet billing (ops/stripe-setup.mjs)",
      })).secret;
    }
  } else if (!sameEvents(hook.enabled_events, events) || hook.status === "disabled") {
    step("update", `webhook ${hook.id}: events → ${events.join(", ")}, enabled`);
    if (apply) await stripe.webhookEndpoints.update(hook.id, { enabled_events: events, disabled: false });
  } else keep(`webhook ${hook.id} → ${want.webhookUrl} (signing secret is shown only at creation: keep your STRIPE_WEBHOOK_SECRET)`);

  const portal = want.portal(Object.entries(TIERS).map(([tier]) => ({
    product: products[tier], prices: want.prices.filter((w) => w.tier === tier).map((w) => env[PRICE_ENV[w.key]]),
  })));
  const current = (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data[0];
  if (current && portalShape(current) === portalShape(portal)) keep(`Customer Portal configuration ${current.id}`);
  else {
    step(current ? "update" : "create", "Customer Portal: cancel at period end, switch between the 4 prices, update card, invoice history, links to /terms and /privacy");
    if (apply) await (current ? stripe.billingPortal.configurations.update(current.id, portal) : stripe.billingPortal.configurations.create(portal));
  }
  return { steps, env, webhookSecret };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const fail = (msg) => { console.error(msg); process.exit(2); };
  let loaded;
  try { loaded = loadEnv(args); } catch (e) { fail(e.message); }
  const site = JSON.parse(readFileSync(SITE_JSON, "utf8"));
  const host = typeof args.domain === "string" ? args.domain : loaded.env.NEXT_PUBLIC_SITE_URL || site.domain;
  if (!host) fail("No domain: pass --domain kismetodds.com, or set NEXT_PUBLIC_SITE_URL or config/site.json domain.");
  const origin = `https://${host.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  const events = webhookEvents();
  if (site.stripe?.mode === "links") console.log('Note: config/site.json stripe.mode is "links": the app uses Payment Links, not these price ids.');

  const key = process.env.STRIPE_SECRET_KEY || loaded.env.STRIPE_SECRET_KEY || "";
  if (!key) {
    console.log(`No STRIPE_SECRET_KEY (looked in the environment and ${loaded.source}). Plan for ${origin}:`);
    for (const w of desired(site, origin).prices) console.log(`  - ensure price ${w.key}: $${(w.unit_amount / 100).toFixed(2)}/${w.interval} (lookup_key ${w.lookup_key})`);
    console.log(`  - ensure products ${Object.values(TIERS).join(", ")}\n  - ensure webhook ${origin}/api/stripe/webhook for ${events.join(", ")}\n  - ensure the default Customer Portal configuration`);
    process.exit(0);
  }
  const live = /^(sk|rk)_live_/.test(key);
  if (live && args.yes && !args.live) fail("This is a LIVE key. Add --live to change the live account.");
  if (!live && args.live) fail("--live was passed but STRIPE_SECRET_KEY is a test key.");
  const base = !live && process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;   // tests: a local mock
  const stripe = new Stripe(key, base
    ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", ""), maxNetworkRetries: 0 }
    : { maxNetworkRetries: 2 });

  console.log(`${args.yes ? "Applying" : "Dry run (reads only; add --yes to apply)"} — Stripe ${live ? "LIVE" : "test"} mode, ${origin}`);
  const { steps, env, webhookSecret } = await setup(stripe, { site, origin, events, apply: !!args.yes });
  for (const s of steps) console.log(`  - ${s}`);
  if (webhookSecret) env.STRIPE_WEBHOOK_SECRET = webhookSecret;

  let text = args.yes && loaded.file ? readFileSync(loaded.file, "utf8") : null;
  console.log(`\nEnv values${text !== null ? ` (empty lines filled in ${rel(loaded.file)})` : " to paste into apps/web/.env.prod and Vercel"}:`);
  for (const [k, v] of Object.entries(env)) {
    const shown = k === "STRIPE_WEBHOOK_SECRET" ? mask(v) : v;   // RT3-08: never in full (CI logs, scrollback)
    if (text === null) { console.log(`${k}=${shown}`); continue; }
    const r = setIfEmpty(text, k, v);
    text = r.text;
    const old = loaded.env[k];
    console.log(`${k}=${shown}${r.changed ? "  (written)" : old === v ? "  (already set)" : `  (file has a different value: replace it by hand)`}`);
  }
  if (text !== null) {
    writeFileSync(loaded.file, text, { mode: 0o600 });
    chmodSync(loaded.file, 0o600);   // the mode above only applies when the file is created
  } else if (webhookSecret) {
    console.log("STRIPE_WEBHOOK_SECRET is masked above. Copy it from Stripe → Developers → Webhooks → this endpoint → Signing secret (Reveal).");
  }
  if (!webhookSecret && args.yes) console.log("STRIPE_WEBHOOK_SECRET: unchanged (the endpoint already existed).");
}
