#!/usr/bin/env node
// Fills config/site.json (owner, legal and Stripe-link values) from flags or a JSON file, validates the result, and
// shows the diff (ops/ship.md step 4). Dry run unless --yes. Not interactive. Re-running with the same values changes nothing.
//
//   node ops/site-config.mjs --domain kismetodds.com --support-email help@kismetodds.com \
//     --operator-names "Jane Doe and John Roe" --state Delaware --refund-policy first_charge_7_days \
//     --response-time "2 business days" [--address "1 Main St, Dover, DE 19901"] [--last-updated today] [--yes]
//   node ops/site-config.mjs --from owner.json --yes      (same shape as config/site.json; only existing keys)
//
// Other flags: --operator-type, --countries, --stripe-mode checkout|links, --link-pro-monthly <url> (and
// --link-pro-yearly, --link-premium-monthly, --link-premium-yearly), --portal-url <url>, --file <site.json>.
// --last-updated defaults to today when a legal field changes and none is given.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, rel, SITE_JSON, validateSite } from "./lib.mjs";

export const FLAGS = {
  domain: "domain", "support-email": "support_email",
  "operator-names": "legal.operator_names", "operator-type": "legal.operator_type", state: "legal.governing_state",
  address: "legal.mailing_address", "refund-policy": "legal.refund_policy", "response-time": "legal.response_time",
  "last-updated": "legal.last_updated", countries: "legal.countries",
  "stripe-mode": "stripe.mode", "portal-url": "stripe.portal_url",
  "link-pro-monthly": "stripe.paymentLinks.pro_monthly", "link-pro-yearly": "stripe.paymentLinks.pro_yearly",
  "link-premium-monthly": "stripe.paymentLinks.premium_monthly", "link-premium-yearly": "stripe.paymentLinks.premium_yearly",
};

export const today = (d = new Date()) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const get = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);

/** Leaf paths of a JSON object: { "legal.state": "x", ... }. */
const leaves = (o, pre = "") => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === "object" && !Array.isArray(v) ? leaves(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]);

/** { site, changes: [[path, old, new]] } or throws on an unknown key / wrong type. Pure. */
export function apply(site, updates, now = new Date()) {
  const next = structuredClone(site);
  const changes = [];
  const set = (path, value) => {
    const old = get(site, path);
    if (old === undefined || (typeof old === "object" && old !== null)) throw new Error(`unknown setting: ${path}`);
    if (typeof value !== typeof old) throw new Error(`${path} must be a ${typeof old}`);
    const v = typeof value === "string" ? value.trim() : value;
    if (v === old) return;
    const keys = path.split(".");
    keys.slice(0, -1).reduce((x, k) => x[k], next)[keys.at(-1)] = v;
    changes.push([path, old, v]);
  };
  for (const [path, value] of Object.entries(updates)) set(path, path === "legal.last_updated" && value === "today" ? today(now) : value);
  if (!("legal.last_updated" in updates) && changes.some(([p]) => p.startsWith("legal."))) set("legal.last_updated", today(now));
  return { site: next, changes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const fail = (msg) => { console.error(msg); process.exit(2); };
  if (args.help) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => /^\/\/( |$)/.test(l)).join("\n")); process.exit(0); }
  const file = typeof args.file === "string" ? resolve(args.file) : SITE_JSON;
  const site = JSON.parse(readFileSync(file, "utf8"));
  const updates = {};
  if (typeof args.from === "string") Object.assign(updates, Object.fromEntries(leaves(JSON.parse(readFileSync(resolve(args.from), "utf8")))));
  for (const [flag, value] of Object.entries(args)) {
    if (["_", "from", "file", "yes", "dry-run"].includes(flag)) continue;
    if (!FLAGS[flag]) fail(`unknown flag --${flag}. Flags: ${Object.keys(FLAGS).map((f) => `--${f}`).join(" ")}`);
    if (value === true) fail(`--${flag} needs a value`);
    updates[FLAGS[flag]] = value;
  }
  let result;
  try { result = apply(site, updates); } catch (e) { fail(e.message); }
  const { site: next, changes } = result;
  const problems = validateSite(next);
  const changed = new Set(changes.map(([p]) => p));
  const bad = problems.filter((p) => p.level === "block" && (changed.has(p.key) || changed.has(p.key.replace(/^stripe\.paymentLinks\..*/, "stripe.mode"))));

  console.log(`${args.yes ? "Writing" : "Dry run (add --yes to write)"}: ${rel(file)}`);
  for (const [p, a, b] of changes) console.log(`  ${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  if (!changes.length) console.log("  no changes");
  for (const p of problems) console.log(`  ${bad.includes(p) ? "INVALID" : p.level === "block" ? "still missing" : "note"}  ${p.key}: ${p.msg}`);
  if (bad.length) { console.error("Not written: fix the INVALID values."); process.exit(1); }
  if (args.yes && changes.length) {
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log("Written. Commit config/site.json (nothing in it is secret), then have a lawyer read /terms, /privacy, /refunds, /disclaimer.");
  }
}
