// Shared by the ops/*.mjs launch scripts (ops/ship.md): repo paths, env-file reading and writing, flag parsing,
// and the config/site.json validation that preflight.mjs and site-config.mjs both use. Node 22+, no dependencies.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WEB = resolve(ROOT, "apps/web");
export const SITE_JSON = resolve(ROOT, "config/site.json");
/** The production env file the scripts fill. Not `.env.production.local`: Next loads that one into local builds and e2e. */
export const PROD_ENV = resolve(WEB, ".env.prod");

/** Server-side secrets: marked Sensitive in Vercel, never printed. Superset of SECRET_ENV in apps/web/scripts/check-bundle.mjs. */
export const SECRET_ENV = ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "EXT_SIGNING_SECRET",
  "RESEND_API_KEY", "CRON_SECRET", "UPSTASH_REDIS_REST_TOKEN", "UNSUBSCRIBE_SECRET", "GITHUB_DATA_TOKEN"];

/** Test-only or not-yet-allowed variables: never set in production, never pushed to Vercel. */
export const MUST_BE_EMPTY = ["E2E_MOCK", "STRIPE_API_BASE", "KALSHI_TRADING_ENV", "DATA_DIR",
  "KALSHI_DEMO_KEY_ID", "KALSHI_DEMO_PRIVATE_KEY_PATH", "KALSHI_DEMO_TICKER"];

export const rel = (p) => relative(process.cwd(), p) || ".";

/** `--flag value` / `--flag=value` / bare `--flag` (true) → object; positionals in `_`. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

export const readEnvFile = (file) => parseEnv(readFileSync(file, "utf8"));

/** --env <file>, else apps/web/.env.prod, else apps/web/.env.local, else the process env. */
export function loadEnv(args) {
  if (typeof args.env === "string") {
    const file = resolve(args.env);
    if (!existsSync(file)) throw new Error(`env file not found: ${args.env}`);
    return { env: readEnvFile(file), source: rel(file), file };
  }
  for (const file of [PROD_ENV, resolve(WEB, ".env.local")]) if (existsSync(file)) return { env: readEnvFile(file), source: rel(file), file };
  return { env: { ...process.env }, source: "process environment", file: null };
}

/** config/site.json, or --site <file> (tests). */
export const loadSite = (args = {}) => JSON.parse(readFileSync(typeof args.site === "string" ? resolve(args.site) : SITE_JSON, "utf8"));

const quote = (v) => (/^[\w@.:/+,=-]*$/.test(v) ? v : JSON.stringify(v));

/** Sets KEY=value in env-file text: fills an empty `KEY=` line in place, else appends. Never touches a non-empty value. */
export function setIfEmpty(text, key, value) {
  const line = new RegExp(`^${key}=(.*)$`, "m");
  const m = line.exec(text);
  if (m && m[1].trim() !== "" && m[1].trim() !== '""') return { text, changed: false };
  const entry = `${key}=${quote(value)}`;
  if (m) return { text: text.replace(line, entry), changed: true };
  return { text: `${text.replace(/\n*$/, "\n")}${entry}\n`, changed: true };
}

/** True when git ignores the file (so a secret written there can't be committed). */
export function gitIgnored(file) {
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** "sk_t…(107 chars)": enough to recognise a value without showing it. */
export const mask = (v) => `${String(v).slice(0, 4)}…(${String(v).length} chars)`;

// ------------------------------------------------------------------ config/site.json
export const REFUND_POLICIES = ["none", "first_charge_7_days", "prorated"];
export const PRICE_KEYS = ["pro_monthly", "pro_yearly", "premium_monthly", "premium_yearly"];
const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[a-z]{2,}$/i;
export const isEmail = (v) => EMAIL.test(v);
const isHttps = (v) => { try { return new URL(v).protocol === "https:"; } catch { return false; } };
const isDomain = (v) => /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(v);
const empty = (v) => !String(v ?? "").trim();

/** Problems in config/site.json: [{ key, level: "block"|"warn", msg }]. Empty legal fields render as [[PLACEHOLDER]]. */
export function validateSite(site) {
  const out = [];
  const block = (key, msg) => out.push({ key, level: "block", msg });
  const warn = (key, msg) => out.push({ key, level: "warn", msg });
  const L = site.legal ?? {};
  if (empty(site.domain)) block("domain", "empty (pages show [[DOMAIN]])");
  else if (!isDomain(site.domain)) block("domain", `"${site.domain}" is not a bare domain like kismetodds.com (no https://, no path)`);
  if (empty(site.support_email)) block("support_email", "empty (pages show [[SUPPORT_EMAIL]])");
  else if (!isEmail(site.support_email)) block("support_email", `"${site.support_email}" is not an email address`);
  for (const [k, ph] of [["operator_names", "OPERATOR_NAMES"], ["governing_state", "GOVERNING_STATE"], ["response_time", "RESPONSE_TIME"], ["last_updated", "LAST_UPDATED"]]) {
    if (empty(L[k])) block(`legal.${k}`, `empty (pages show [[${ph}]])`);
  }
  if (empty(L.refund_policy)) block("legal.refund_policy", `empty: one of ${REFUND_POLICIES.join(", ")}, or your own sentence`);
  else if (!REFUND_POLICIES.includes(L.refund_policy) && L.refund_policy.trim().length < 20) {
    block("legal.refund_policy", `"${L.refund_policy}" is not one of ${REFUND_POLICIES.join(", ")}; a custom policy must be a full sentence`);
  }
  if (!empty(L.last_updated) && Number.isNaN(Date.parse(L.last_updated))) warn("legal.last_updated", `"${L.last_updated}" doesn't read as a date (e.g. "November 18, 2026")`);
  if (empty(L.mailing_address)) warn("legal.mailing_address", "empty: optional, but required before sending any marketing email (CAN-SPAM)");
  if (/\[\[[A-Z_]+\]\]/.test(JSON.stringify(site))) block("site.json", "contains a literal [[PLACEHOLDER]]");
  const mode = site.stripe?.mode;
  if (mode !== "checkout" && mode !== "links") block("stripe.mode", `"${mode}" must be "checkout" or "links"`);
  if (mode === "links") {
    for (const k of PRICE_KEYS) {
      const v = site.stripe.paymentLinks?.[k];
      if (!v || !isHttps(v)) block(`stripe.paymentLinks.${k}`, v ? `"${v}" is not an https URL` : "empty (Payment Links mode needs all 4)");
    }
  }
  if (!empty(site.stripe?.portal_url) && !isHttps(site.stripe.portal_url)) block("stripe.portal_url", "not an https URL");
  for (const k of PRICE_KEYS) {
    if (!(Number(site.prices_usd?.[k]) > 0)) block(`prices_usd.${k}`, "must be a positive number of dollars");
  }
  return out;
}
