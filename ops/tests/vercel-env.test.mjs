// A fake `vercel` on PATH records each call and its stdin; nothing reaches Vercel.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commands, show } from "../vercel-env.mjs";
import { ROOT } from "../lib.mjs";
import { GOOD_ENV, GOOD_SITE } from "./fixtures.mjs";

test("commands: production + preview, secrets sensitive, test-only vars skipped", () => {
  const cs = commands({ STRIPE_SECRET_KEY: "sk_test_x", DATA_SOURCE: "supabase", E2E_MOCK: "1", NEXT_PUBLIC_DEMO_MODE: "false", EMPTY: "" });
  assert.deepEqual(cs.map((c) => `${c.key}/${c.target}/${c.sensitive}`), [
    "STRIPE_SECRET_KEY/production/true", "STRIPE_SECRET_KEY/preview/true", "DATA_SOURCE/production/false", "DATA_SOURCE/preview/false"]);
  assert.deepEqual(cs[0].args, ["env", "add", "STRIPE_SECRET_KEY", "production", "--force", "--sensitive"]);
  assert.doesNotMatch(show({ ...cs[0], value: "sk_test_SECRETVALUE" }), /SECRETVALUE/);
  assert.match(show(cs[2]), /printf '%s' 'supabase' \| vercel env add DATA_SOURCE production --force$/);
});

test("CLI --yes: refuses with preflight blockers, else feeds values on stdin", () => {
  const dir = mkdtempSync(join(tmpdir(), "me-vercel-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(dir, ".vercel"));
  writeFileSync(join(dir, ".vercel/project.json"), "{}");
  const log = join(dir, "log");
  writeFileSync(join(bin, "vercel"), `#!/bin/sh\nprintf '%s|' "$*" >> "${log}"\n[ "$1" = whoami ] || cat >> "${log}"\necho >> "${log}"\n`);
  chmodSync(join(bin, "vercel"), 0o755);
  const site = join(dir, "site.json");
  writeFileSync(site, JSON.stringify(GOOD_SITE));
  const envFile = join(dir, ".env");
  const run = (env) => {
    writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n"));
    return execFileSync("node", [join(ROOT, "ops/vercel-env.mjs"), "--env", envFile, "--site", site, "--cwd", dir, "--yes"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  };
  assert.throws(() => run({ ...GOOD_ENV, DEMO_MODE: "true" }), /Command failed/);
  assert.throws(() => readFileSync(log), "nothing ran");

  const out = run(GOOD_ENV);
  assert.doesNotMatch(out, new RegExp(GOOD_ENV.STRIPE_SECRET_KEY), "secret never printed");
  const lines = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines[0], "whoami|");
  assert.ok(lines.includes(`env add STRIPE_SECRET_KEY production --force --sensitive|${GOOD_ENV.STRIPE_SECRET_KEY}`));
  assert.ok(lines.includes("env add DATA_SOURCE preview --force|supabase"));
  assert.equal(lines.length, 1 + 2 * Object.keys(GOOD_ENV).length);
});

// AUDIT run 3 fail 4: never push the shell environment, and never a key .env.example doesn't list.
test("commands: only keys listed in apps/web/.env.example", () => {
  const cs = commands({ DATA_SOURCE: "supabase", PATH: "/usr/bin", HOME: "/Users/x", CLAUDE_CODE_MESSAGING_TOKEN: "tok", SSH_AUTH_SOCK: "/tmp/s" });
  assert.deepEqual(cs.map((c) => c.key), ["DATA_SOURCE", "DATA_SOURCE"]);
});

test("CLI: refuses (exit 2) with no env file instead of reading the shell environment", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "me-vercel-noenv-")));   // macOS /var → /private/var, or the CLI guard skips main
  const site = join(dir, "site.json");
  writeFileSync(site, JSON.stringify(GOOD_SITE));
  // Point the default env-file lookup at an empty web dir by running a copy of the ops scripts.
  const ops = join(dir, "ops");
  mkdirSync(join(dir, "apps/web"), { recursive: true });
  writeFileSync(join(dir, "apps/web/.env.example"), readFileSync(join(ROOT, "apps/web/.env.example")));
  mkdirSync(ops);
  for (const f of ["vercel-env.mjs", "lib.mjs", "preflight.mjs"]) writeFileSync(join(ops, f), readFileSync(join(ROOT, "ops", f)));
  let err;
  try {
    execFileSync("node", [join(ops, "vercel-env.mjs"), "--site", site], { encoding: "utf8", stdio: "pipe", env: { ...process.env, ...GOOD_ENV } });
  } catch (e) { err = e; }
  assert.ok(err, "must not exit 0");
  assert.equal(err.status, 2);
  assert.match(err.stderr, /no env file/);
  assert.doesNotMatch(err.stdout ?? "", /vercel env add/);
});
