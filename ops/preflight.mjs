#!/usr/bin/env node
// Production preflight (ops/ship.md step 8). Reads the production env file and config/site.json and reports every
// missing, malformed or dangerous value, grouped by service, with where to get it. Exit 1 on any blocker.
// Read-only: changes nothing, contacts nothing.
//
//   cd apps/web && pnpm preflight [--env <file>] [--live]      (or from the repo root: node ops/preflight.mjs ...)
//
// --env   env file to check. Default: apps/web/.env.prod, else apps/web/.env.local, else the process environment.
// --live  launch check: Stripe test keys become blockers.
// --site  site.json to check instead of config/site.json.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isEmail, loadEnv, MUST_BE_EMPTY, parseArgs, SECRET_ENV, loadSite, validateSite } from "./lib.mjs";

/** Service → where to get its values (SETUP.md sections, setup notes). */
export const GROUPS = {
  danger: ["Test-only and unsafe settings", "SETUP.md §2: leave these empty in production"],
  core: ["Core", "SETUP.md §2 (Every value and where it goes)"],
  supabase: ["Supabase", "Supabase → Project settings → API. SETUP.md §1 #2, docs/setup-notes/lane-l.md §1"],
  stripe: ["Stripe", "node ops/stripe-setup.mjs prints these. SETUP.md §1 #4, docs/setup-notes/lane-l.md §3"],
  secrets: ["Generated secrets", "node ops/secrets.mjs --yes. SETUP.md §2"],
  upstash: ["Upstash Redis", "Upstash console → database → REST API. docs/setup-notes/ops.md §8"],
  email: ["Resend (email)", "Resend → API keys. docs/setup-notes/ops.md §7"],
  data: ["GitHub data fallback", "Fine-grained read-only token. docs/setup-notes/ops.md §3"],
  monitoring: ["Sentry / PostHog", "docs/setup-notes/ops.md §5–6"],
  extension: ["Chrome extension", "Chrome Web Store dashboard. docs/setup-notes/trading-extension.md §4–5"],
  admin: ["Admin", "docs/setup-notes/admin.md §1"],
  site: ["config/site.json (owner and legal values)", "node ops/site-config.mjs ... --yes. LAUNCH_TODO.md #1"],
};

const https = (v) => { try { return new URL(v).protocol === "https:" ? null : "must start with https://"; } catch { return "is not a URL"; } };
const secret32 = (v) => (v.length >= 32 ? null : `is ${v.length} characters; needs 32+ (node ops/secrets.mjs generates one)`);
const re = (r, hint) => (v) => (r.test(v) ? null : hint);
const emails = (v) => {
  const bad = v.split(",").map((s) => s.trim()).filter((s) => !isEmail(s));
  return bad.length ? `not an email: ${bad.map((b) => JSON.stringify(b)).join(", ")}` : null;
};
const PRICE_ENV = ["STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY", "STRIPE_PRICE_PREMIUM_MONTHLY", "STRIPE_PRICE_PREMIUM_YEARLY"];

/** [key, group, required (bool | (env, ctx) => bool), validator | null, why it matters when missing]. */
const RULES = [
  ["DATA_SOURCE", "core", true, re(/^(supabase|github|local)$/, "must be supabase, github or local")],
  ["NEXT_PUBLIC_SITE_URL", "core", true, (v, env, ctx) => https(v) ?? (new URL(v).pathname !== "/" || v.endsWith("/") ? "must be the bare origin, e.g. https://kismetodds.com (no path, no trailing slash)"
    : ctx.site.domain && ![ctx.site.domain, `www.${ctx.site.domain}`].includes(new URL(v).hostname) ? `host doesn't match config/site.json domain "${ctx.site.domain}"` : null)],
  ["HEALTH_MAX_DATA_AGE_MIN", "core", false, re(/^[1-9]\d*$/, "must be a whole number of minutes")],
  ["NEXT_PUBLIC_SUPABASE_URL", "supabase", true, (v) => https(v) ?? (/\.supabase\.co\/?$/.test(v) ? null : "expected https://<ref>.supabase.co")],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "supabase", true, re(/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_\w{10,})$/, "expected the anon (eyJ…) or publishable (sb_publishable_…) key")],
  ["SUPABASE_SERVICE_ROLE_KEY", "supabase", true, (v, env) => (!/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_\w{10,})$/.test(v) ? "expected the service_role (eyJ…) or secret (sb_secret_…) key"
    : v === env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "is the same as the anon key: paste the service_role key" : null)],
  ["STRIPE_SECRET_KEY", "stripe", true, (v, env, ctx) => (!/^(sk|rk)_(live|test)_\w{10,}$/.test(v) ? "expected sk_live_…, sk_test_… (or a restricted rk_…)"
    : ctx.live && /_test_/.test(v) ? "is a TEST key and --live was passed: use the live key" : null)],
  ["STRIPE_WEBHOOK_SECRET", "stripe", true, re(/^whsec_\w{10,}$/, "expected whsec_…")],
  ...PRICE_ENV.map((k) => [k, "stripe", (env, ctx) => ctx.site.stripe?.mode !== "links", re(/^price_\w{6,}$/, "expected price_…"),
    "Checkout mode needs all 4 price ids (or set stripe.mode = \"links\" in config/site.json)"]),
  ["STRIPE_PORTAL_URL", "stripe", false, https],
  ["CRON_SECRET", "secrets", true, secret32, "/api/alerts/run and /api/settle/run refuse every call"],
  ["UNSUBSCRIBE_SECRET", "secrets", true, secret32, "alert emails can't build their unsubscribe link"],
  ["EXT_SIGNING_SECRET", "secrets", true, secret32, "extension sign-in and order nonces are off outside demo mode"],
  ["UPSTASH_REDIS_REST_URL", "upstash", true, https, "rate limits fall back to per-instance memory and /api/health returns 503"],
  ["UPSTASH_REDIS_REST_TOKEN", "upstash", true, re(/^\S{20,}$/, "looks too short for an Upstash REST token")],
  ["RESEND_API_KEY", "email", false, re(/^re_\w{8,}/, "expected re_…"), "no alert or payment-failed emails are sent"],
  ["EMAIL_FROM", "email", (env) => !!env.RESEND_API_KEY, (v) => {
    const m = /^(?:[^<>]+<([^<>]+)>|([^<>\s]+))$/.exec(v.trim());
    return m && isEmail(m[1] ?? m[2]) ? null : 'expected "Kismet <alerts@mail.yourdomain.com>"';
  }],
  ["GITHUB_DATA_TOKEN", "data", (env) => env.DATA_SOURCE === "github", re(/^(github_pat_|ghp_)\w{20,}$/, "expected github_pat_… (fine-grained, Contents: read)"),
    "no fallback when the Supabase bucket is empty"],
  ["GITHUB_DATA_REPO", "data", (env) => !!env.GITHUB_DATA_TOKEN, re(/^[\w.-]+\/[\w.-]+$/, "expected owner/repo")],
  ["NEXT_PUBLIC_SENTRY_DSN", "monitoring", false, https, "errors are not reported"],
  ["NEXT_PUBLIC_POSTHOG_KEY", "monitoring", false, re(/^phc_\w{10,}$/, "expected phc_…"), "no product analytics"],
  ["NEXT_PUBLIC_POSTHOG_HOST", "monitoring", (env) => !!env.NEXT_PUBLIC_POSTHOG_KEY, https],
  ["NEXT_PUBLIC_EXTENSION_ID", "extension", false, re(/^[a-p]{32}$/, "expected the 32-letter Chrome Web Store id"),
    "the extension can't sign in until it is published (fine before step 9 of LAUNCH_TODO.md)"],
  ["NEXT_PUBLIC_EXTENSION_STORE_URL", "extension", false, https],
  ["ADMIN_EMAILS", "admin", true, emails, "nobody can open /admin"],
  ["TRADING_ALLOWLIST", "admin", false, emails],
];

/** Every problem: [{ group, key, level: "block"|"warn", msg }]. Pure: env object + parsed site.json in, list out. */
export function check(env, site, { live = false } = {}) {
  const ctx = { site, live };
  const out = [];
  const add = (group, key, level, msg) => out.push({ group, key, level, msg });
  const val = (k) => (env[k] ?? "").trim();

  // Dangerous production combinations first.
  if (val("DEMO_MODE") === "true") add("danger", "DEMO_MODE", "block", "is true: no sign-in, no billing, every visitor gets Premium free. Set false");
  else if (val("DEMO_MODE") && val("DEMO_MODE") !== "false") add("danger", "DEMO_MODE", "warn", `"${val("DEMO_MODE")}" is treated as off; write false`);
  for (const k of MUST_BE_EMPTY) {
    if (!val(k)) continue;
    const why = { KALSHI_TRADING_ENV: "turns on paper trading in production (LAUNCH_TODO.md, real-money section)",
      E2E_MOCK: "test mock switch", STRIPE_API_BASE: "points Stripe at a test mock" }[k];
    add("danger", k, why ? "block" : "warn", `is set: ${why ?? "test-only, leave empty"}`);
  }
  if (val("KALSHI_DATA_PERMISSION") === "true") add("danger", "KALSHI_DATA_PERMISSION", "warn", "is true: only with Kalshi's written data permission");
  if (val("DATA_SOURCE") === "local") add("core", "DATA_SOURCE", "warn", "is local: production serves the scan baked into the deploy, never refreshed. Use supabase");

  for (const [k, group, required, validate, why] of RULES) {
    const v = val(k);
    const need = typeof required === "function" ? required(env, ctx) : required;
    if (!v) {
      if (need) add(group, k, "block", `missing${why ? ` (${why})` : ""}`);
      else if (why) add(group, k, "warn", `empty: ${why}`);
      continue;
    }
    const err = validate?.(v, env, ctx);
    if (err) add(group, k, "block", err);
  }

  for (const [k, v] of Object.entries(env)) {
    if (/\[\[[A-Z_]+\]\]/.test(v ?? "")) add("danger", k, "block", "still holds a [[PLACEHOLDER]]");
  }
  const secrets = ["CRON_SECRET", "UNSUBSCRIBE_SECRET", "EXT_SIGNING_SECRET"].filter((k) => val(k));
  if (new Set(secrets.map(val)).size < secrets.length) add("secrets", secrets.join(", "), "warn", "two of these share a value; give each its own");
  for (const k of Object.keys(env)) {
    if (k.startsWith("NEXT_PUBLIC_") && SECRET_ENV.includes(k.slice(12))) add("danger", k, "block", "exposes a server secret to every browser; remove it");
  }

  for (const p of validateSite(site)) add("site", p.key, p.level, p.msg);
  return out;
}

export function report(problems, source) {
  const lines = [];
  for (const [g, [title, where]] of Object.entries(GROUPS)) {
    const ps = problems.filter((p) => p.group === g);
    if (!ps.length) continue;
    lines.push("", `${title}  —  ${where}`);
    for (const p of ps) lines.push(`  ${p.level === "block" ? "BLOCK" : "warn "}  ${p.key}: ${p.msg}`);
  }
  const b = problems.filter((p) => p.level === "block").length;
  const w = problems.length - b;
  lines.unshift(`Kismet preflight — ${source} + config/site.json`);
  lines.push("", b ? `${b} blocker(s), ${w} warning(s). Fix the BLOCK lines before deploying.` : `No blockers. ${w} warning(s).`);
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("// ") || l === "//").join("\n")); process.exit(0); }
  let loaded;
  try { loaded = loadEnv(args); } catch (e) { console.error(e.message); process.exit(2); }
  const site = loadSite(args);
  const problems = check(loaded.env, site, { live: !!args.live });
  console.log(report(problems, `${loaded.source}${args.live ? " (--live)" : ""}`));
  process.exit(problems.some((p) => p.level === "block") ? 1 : 0);
}
