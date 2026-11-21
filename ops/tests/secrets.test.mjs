import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { GENERATED, plan } from "../secrets.mjs";
import { ROOT, WEB } from "../lib.mjs";

const example = readFileSync(join(WEB, ".env.example"), "utf8");

test("plan: new file from the example, production defaults, all secrets 32+ chars", () => {
  const { text, changed } = plan(null, example);
  const env = parseEnv(text);
  assert.ok(changed);
  assert.equal(env.DEMO_MODE, "false");
  assert.equal(env.DATA_SOURCE, "supabase");
  for (const k of Object.keys(GENERATED)) assert.ok(env[k].length >= 32, k);
  assert.equal(text.match(/^CRON_SECRET=/gm).length, 1, "filled in place, not appended twice");
});

test("plan: never overwrites, second run is a no-op", () => {
  const first = plan(null, example).text;
  const second = plan(first, example);
  assert.equal(second.changed, false);
  assert.equal(second.text, first);
  const custom = plan("CRON_SECRET=mine\n", example);
  assert.equal(parseEnv(custom.text).CRON_SECRET, "mine");
  assert.ok(parseEnv(custom.text).EXT_SIGNING_SECRET.length >= 32, "missing keys appended");
});

test("CLI: dry run writes nothing; --yes writes mode 600; refuses tracked paths", () => {
  const file = join(WEB, `.env.secrets-test-${process.pid}`);   // ignored by .gitignore (.env*)
  const run = (...a) => execFileSync("node", [join(ROOT, "ops/secrets.mjs"), "--env", file, ...a], { encoding: "utf8" });
  try {
    assert.match(run(), /Dry run/);
    assert.throws(() => statSync(file));
    run("--yes");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const before = readFileSync(file, "utf8");
    assert.match(run("--yes"), /Nothing to do/);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.doesNotMatch(run(), new RegExp(parseEnv(before).CRON_SECRET), "values never printed");
  } finally {
    rmSync(file, { force: true });
  }
  const tracked = join(ROOT, "ops/not-ignored.env");
  writeFileSync(tracked, "");
  try {
    assert.throws(() => execFileSync("node", [join(ROOT, "ops/secrets.mjs"), "--env", tracked, "--yes"], { stdio: "pipe" }), /status 2|Command failed/);
    assert.equal(readFileSync(tracked, "utf8"), "");
  } finally {
    rmSync(tracked, { force: true });
  }
});
