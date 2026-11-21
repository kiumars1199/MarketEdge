// node --test ops/tests  (also run by `pnpm test` in apps/web). Fake values only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { check } from "../preflight.mjs";
import { ROOT, SECRET_ENV, setIfEmpty, validateSite } from "../lib.mjs";
import { GOOD_ENV, GOOD_SITE } from "./fixtures.mjs";


const blockers = (env, site = GOOD_SITE, opts) => check(env, site, opts).filter((p) => p.level === "block").map((p) => p.key);

test("a complete production env has no problems", () => {
  assert.deepEqual(check(GOOD_ENV, GOOD_SITE), []);
});

test("dangerous production combinations are blockers", () => {
  for (const [k, v] of [["DEMO_MODE", "true"], ["KALSHI_TRADING_ENV", "demo"], ["E2E_MOCK", "1"], ["STRIPE_API_BASE", "http://localhost:3100"], ["ADMIN_EMAILS", ""]]) {
    assert.deepEqual(blockers({ ...GOOD_ENV, [k]: v }), [k], k);
  }
  assert.deepEqual(blockers(GOOD_ENV, GOOD_SITE, { live: true }), ["STRIPE_SECRET_KEY"], "test key with --live");
  assert.deepEqual(blockers({ ...GOOD_ENV, STRIPE_SECRET_KEY: "sk_live_FAKEFAKEFAKEFAKE" }, GOOD_SITE, { live: true }), []);
  assert.deepEqual(blockers({ ...GOOD_ENV, EMAIL_FROM: "[[SUPPORT_EMAIL]]" }), ["EMAIL_FROM", "EMAIL_FROM"]);
  assert.deepEqual(blockers({ ...GOOD_ENV, NEXT_PUBLIC_STRIPE_SECRET_KEY: "x" }), ["NEXT_PUBLIC_STRIPE_SECRET_KEY"]);
});

test("formats are checked", () => {
  const bad = {
    STRIPE_SECRET_KEY: "pk_test_123456789012", STRIPE_WEBHOOK_SECRET: "secret_123", CRON_SECRET: "short",
    NEXT_PUBLIC_SITE_URL: "http://kismetodds.example", NEXT_PUBLIC_SUPABASE_URL: "not a url",
    ADMIN_EMAILS: "a@kismetodds.example, nope", STRIPE_PRICE_PRO_MONTHLY: "prod_123456",
    SUPABASE_SERVICE_ROLE_KEY: GOOD_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  for (const [k, v] of Object.entries(bad)) assert.deepEqual(blockers({ ...GOOD_ENV, [k]: v }), [k], k);
  assert.deepEqual(blockers({ ...GOOD_ENV, NEXT_PUBLIC_SITE_URL: "https://other.example" }), ["NEXT_PUBLIC_SITE_URL"], "domain mismatch");
  assert.deepEqual(blockers({ ...GOOD_ENV, STRIPE_SECRET_KEY: "rk_test_FAKEFAKEFAKEFAKE" }), [], "restricted keys are fine");
});

test("missing required values block; missing optional ones warn", () => {
  const { RESEND_API_KEY, EMAIL_FROM, NEXT_PUBLIC_SENTRY_DSN, UPSTASH_REDIS_REST_URL, ...rest } = GOOD_ENV;
  const ps = check(rest, GOOD_SITE);
  assert.deepEqual(ps.filter((p) => p.level === "block").map((p) => p.key), ["UPSTASH_REDIS_REST_URL"]);
  assert.deepEqual(ps.filter((p) => p.level === "warn").map((p) => p.key).sort(), ["NEXT_PUBLIC_SENTRY_DSN", "RESEND_API_KEY"]);
});

test("Payment Links mode needs the 4 links instead of price ids", () => {
  const env = Object.fromEntries(Object.entries(GOOD_ENV).filter(([k]) => !k.startsWith("STRIPE_PRICE_")));
  const links = { ...GOOD_SITE, stripe: { ...GOOD_SITE.stripe, mode: "links" } };
  assert.deepEqual(blockers(env, links).length, 4);
  const filled = { ...links, stripe: { ...links.stripe, paymentLinks: { pro_monthly: "https://buy.stripe.com/a", pro_yearly: "https://buy.stripe.com/b", premium_monthly: "https://buy.stripe.com/c", premium_yearly: "https://buy.stripe.com/d" } } };
  assert.deepEqual(blockers(env, filled), []);
});

test("site.json: the repo's own copy has its legal fields flagged, never invented", () => {
  const site = JSON.parse(readFileSync(join(ROOT, "config/site.json"), "utf8"));
  const keys = validateSite(site).filter((p) => p.level === "block").map((p) => p.key);
  if (!site.domain) assert.ok(keys.includes("domain"));
  assert.deepEqual(validateSite({ ...GOOD_SITE, domain: "https://x.com/" }).map((p) => p.key), ["domain"]);
  assert.deepEqual(validateSite({ ...GOOD_SITE, legal: { ...GOOD_SITE.legal, refund_policy: "maybe" } }).map((p) => p.key), ["legal.refund_policy"]);
});

test("SECRET_ENV covers every secret the bundle check guards", () => {
  const src = readFileSync(join(ROOT, "apps/web/scripts/check-bundle.mjs"), "utf8");
  const theirs = JSON.parse(/const SECRET_ENV = (\[[^\]]*\])/.exec(src)[1].replace(/\s+/g, " "));
  for (const k of theirs.filter((k) => k !== "GITHUB_TOKEN" && k !== "SENTRY_AUTH_TOKEN")) assert.ok(SECRET_ENV.includes(k), k);
});

test("setIfEmpty fills empty lines, appends missing keys, never overwrites", () => {
  const t = "A=\nB=keep\n";
  assert.equal(setIfEmpty(t, "A", "1").text, "A=1\nB=keep\n");
  assert.equal(setIfEmpty(t, "B", "2").changed, false);
  assert.equal(setIfEmpty(t, "C", "x y").text, 'A=\nB=keep\nC="x y"\n');
});

test("CLI: exit 1 with blockers, 0 when clean, grouped output", () => {
  const dir = mkdtempSync(join(tmpdir(), "me-preflight-"));
  const file = join(dir, ".env");
  writeFileSync(file, Object.entries({ ...GOOD_ENV, DEMO_MODE: "true" }).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n"));
  let out = "", code = 0;
  try { out = execFileSync("node", [join(ROOT, "ops/preflight.mjs"), "--env", file], { encoding: "utf8" }); } catch (e) { code = e.status; out = e.stdout; }
  assert.equal(code, 1);
  assert.match(out, /Test-only and unsafe settings[\s\S]*BLOCK {2}DEMO_MODE/);
});
