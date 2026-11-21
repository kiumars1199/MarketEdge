// docs/15 § Secrets: after `next build`, fail if anything secret reached the browser bundle (.next/static).
// Looks for server-only env var names, secret key shapes, and the values of any secret env set during the build.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SECRET_ENV = ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "EXT_SIGNING_SECRET",
  "RESEND_API_KEY", "CRON_SECRET", "UPSTASH_REDIS_REST_TOKEN", "UNSUBSCRIBE_SECRET", "GITHUB_TOKEN", "SENTRY_AUTH_TOKEN"];
const SHAPES = [/\bsk_(live|test)_[0-9a-zA-Z]{10,}/, /\bwhsec_[0-9a-zA-Z]{10,}/, /\brk_(live|test)_[0-9a-zA-Z]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"role"\s*:\s*"service_role"/, /\bre_[0-9a-zA-Z]{8,}_[0-9a-zA-Z]{8,}/];
const values = SECRET_ENV.map((k) => process.env[k]).filter((v) => v && v.length >= 8);

const dir = ".next/static";
const files = readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.(js|css|json|html|txt|map)$/.test(e.name)).map((e) => join(e.parentPath, e.name));
if (!files.length) throw new Error(`${dir} is empty: run next build first`);
const hits = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const k of SECRET_ENV) if (text.includes(k)) hits.push(`${f}: names ${k}`);
  for (const re of SHAPES) if (re.test(text)) hits.push(`${f}: matches ${re}`);
  if (values.some((v) => text.includes(v))) hits.push(`${f}: contains a secret env value`);
}
if (hits.length) { console.error("Secrets in the browser bundle:\n" + hits.join("\n")); process.exit(1); }
console.log(`check-bundle: ${files.length} files in ${dir}, no secrets`);
