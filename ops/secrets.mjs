#!/usr/bin/env node
// Generates the app's own secrets into the production env file (ops/ship.md step 3). Never overwrites a value,
// never prints one, refuses a file git would commit. Dry run unless --yes.
//
//   node ops/secrets.mjs [--env apps/web/.env.prod] [--yes]
//
// A missing env file is first created from apps/web/.env.example with production defaults
// (DEMO_MODE=false, DATA_SOURCE=supabase). Written with mode 600.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitIgnored, parseArgs, PROD_ENV, rel, setIfEmpty, WEB } from "./lib.mjs";

/** Every secret the app signs or checks with (nothing else is generated: the rest come from a provider). */
export const GENERATED = {
  CRON_SECRET: { make: () => randomBytes(32).toString("hex"), what: "64 hex chars (Vercel Cron bearer)" },
  UNSUBSCRIBE_SECRET: { make: () => randomBytes(32).toString("hex"), what: "64 hex chars (signs unsubscribe links)" },
  EXT_SIGNING_SECRET: { make: () => randomBytes(48).toString("base64url"), what: "64 base64url chars (extension tokens, order nonces)" },
};

/** The template: .env.example with the two values production must differ on. */
export const fromExample = (text) => text.replace(/^DEMO_MODE=.*$/m, "DEMO_MODE=false").replace(/^DATA_SOURCE=.*$/m, "DATA_SOURCE=supabase");

/** { text, steps } for the file's current text (null = file missing). Pure apart from randomness. */
export function plan(current, example) {
  const steps = [];
  let text = current;
  if (text === null) {
    text = fromExample(example);
    steps.push("create the file from apps/web/.env.example with DEMO_MODE=false, DATA_SOURCE=supabase");
  }
  for (const [k, g] of Object.entries(GENERATED)) {
    const r = setIfEmpty(text, k, g.make());
    text = r.text;
    steps.push(r.changed ? `generate ${k}: ${g.what}` : `keep ${k}: already set`);
  }
  return { text, steps, changed: text !== current };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const file = typeof args.env === "string" ? resolve(args.env) : PROD_ENV;
  if (!gitIgnored(file)) {
    console.error(`Refusing: git does not ignore ${rel(file)}, so a secret written there could be committed.`);
    process.exit(2);
  }
  const { text, steps, changed } = plan(existsSync(file) ? readFileSync(file, "utf8") : null, readFileSync(resolve(WEB, ".env.example"), "utf8"));
  console.log(`${args.yes ? "Writing" : "Dry run (add --yes to write)"}: ${rel(file)}`);
  for (const s of steps) console.log(`  - ${s}`);
  if (!changed) console.log("Nothing to do.");
  else if (args.yes) {
    writeFileSync(file, text, { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log("Done. Values are in the file, not printed. Next: node ops/preflight.mjs");
  }
}
