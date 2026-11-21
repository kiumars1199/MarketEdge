#!/usr/bin/env node
// Turns the filled production env file into `vercel env add` commands for Production and Preview (ops/ship.md step 9).
// Prints them by default (secret values masked). With --yes it runs them, feeding each value on stdin so it never
// shows in the process list or the terminal; that needs the vercel CLI, `vercel login`, and `vercel link` in apps/web.
// Refuses --yes while preflight has blockers. Safe to re-run: --force replaces a variable that already exists.
// Reads only an env file (never the shell environment) and pushes only keys listed in apps/web/.env.example.
//
//   node ops/vercel-env.mjs [--env apps/web/.env.prod] [--targets production,preview] [--yes]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check } from "./preflight.mjs";
import { loadEnv, mask, MUST_BE_EMPTY, parseArgs, readEnvFile, SECRET_ENV, loadSite, WEB } from "./lib.mjs";

/** Never pushed: test-only switches, and NEXT_PUBLIC_DEMO_MODE (next.config derives it from DEMO_MODE). */
export const SKIP = new Set([...MUST_BE_EMPTY, "NEXT_PUBLIC_DEMO_MODE"]);

/** The only keys ever pushed: the ones apps/web/.env.example documents (AUDIT run 3 fail 4). */
export const ALLOWED = new Set(Object.keys(readEnvFile(resolve(WEB, ".env.example"))));

/** One entry per (variable, target), in file order. Keys outside ALLOWED are never pushed. */
export function commands(env, targets = ["production", "preview"]) {
  const out = [];
  for (const [key, raw] of Object.entries(env)) {
    const value = (raw ?? "").trim();
    if (!value || SKIP.has(key) || !ALLOWED.has(key)) continue;
    const sensitive = SECRET_ENV.includes(key);
    for (const target of targets) {
      out.push({ key, target, value, sensitive, args: ["env", "add", key, target, "--force", ...(sensitive ? ["--sensitive"] : [])] });
    }
  }
  return out;
}

export const show = (c) => `printf '%s' ${c.sensitive ? `"<${c.key}: ${mask(c.value)}>"` : `'${c.value.replace(/'/g, "'\\''")}'`} | vercel ${c.args.join(" ")}`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const fail = (msg) => { console.error(msg); process.exit(2); };
  let loaded;
  try { loaded = loadEnv(args); } catch (e) { fail(e.message); }
  // Never fall back to the shell environment: it holds PATH, HOME, agent tokens and other keys that must not reach Vercel.
  if (!loaded.file) fail("Refusing: no env file. Create apps/web/.env.prod (node ops/secrets.mjs --yes, ops/ship.md step 3) or pass --env <file>.");
  const cwd = typeof args.cwd === "string" ? resolve(args.cwd) : WEB;
  const targets = typeof args.targets === "string" ? args.targets.split(",") : ["production", "preview"];
  const blockers = check(loaded.env, loadSite(args)).filter((p) => p.level === "block");
  const cmds = commands(loaded.env, targets);

  console.log(`${args.yes ? "Running" : "Dry run (add --yes to run)"}: ${cmds.length} commands from ${loaded.source}, in ${cwd}\n`);
  for (const c of cmds) console.log(show(c));
  const skipped = Object.keys(loaded.env).filter((k) => SKIP.has(k) && loaded.env[k]);
  if (skipped.length) console.log(`\nNot pushed (test-only): ${skipped.join(", ")}`);
  const unknown = Object.keys(loaded.env).filter((k) => !SKIP.has(k) && !ALLOWED.has(k) && loaded.env[k]);
  if (unknown.length) console.log(`\nNot pushed (not in apps/web/.env.example): ${unknown.join(", ")}`);
  console.log("\nBy hand, once: Vercel → Project → Settings → General → Root Directory = apps/web (the CLI has no setting for it).");
  if (blockers.length) console.log(`\npreflight has ${blockers.length} blocker(s): node ops/preflight.mjs${args.env ? ` --env ${args.env}` : ""}`);
  if (!args.yes) process.exit(0);

  if (blockers.length) fail("Refusing to push while preflight has blockers.");
  try { execFileSync("vercel", ["whoami"], { cwd, stdio: "ignore" }); } catch { fail("The vercel CLI isn't installed or logged in: npm i -g vercel && vercel login"); }
  if (!existsSync(resolve(cwd, ".vercel/project.json"))) fail(`Not linked: cd ${cwd} && vercel link`);
  for (const c of cmds) {
    process.stdout.write(`${c.key} → ${c.target} ... `);
    execFileSync("vercel", c.args, { cwd, input: c.value, stdio: ["pipe", "ignore", "inherit"] });
    console.log("ok");
  }
  console.log("\nDone. Env changes apply on the next deploy: push to main, or Vercel → Deployments → Redeploy.");
}
