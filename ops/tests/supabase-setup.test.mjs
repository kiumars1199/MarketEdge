// Fake `supabase` and `curl` on PATH record their calls; nothing reaches Supabase.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../lib.mjs";

const REF = "abcdefghijklmnopqrst";
const KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlc3Jr";

function setup(createReply) {
  const dir = mkdtempSync(join(tmpdir(), "me-supabase-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "log");
  writeFileSync(join(bin, "supabase"), `#!/bin/sh\necho "supabase $*" >> "${log}"\n`);
  // curl: logs method + URL (+ whether a key reached argv), writes a canned body to -o, prints the code for -w.
  writeFileSync(join(bin, "curl"), `#!/bin/sh
m=GET; out=/dev/null; w=""; url=""
case "$*" in *${KEY}*) echo "KEY IN ARGV" >> "${log}";; esac
while [ $# -gt 0 ]; do case "$1" in -X) m=$2; shift;; -o) out=$2; shift;; -w) w=1; shift;; -H|-d) shift;; http*) url=$1;; esac; shift; done
echo "curl $m $url" >> "${log}"
if [ "$m" = POST ]; then printf '%s' '${createReply.body}' > "$out"; [ -n "$w" ] && printf ${createReply.code}
elif [ "$m" = PUT ]; then printf '{}' > "$out"; [ -n "$w" ] && printf 200
else printf '{"id":"scan","public":false}' > "$out"; fi
`);
  for (const f of ["supabase", "curl"]) chmodSync(join(bin, f), 0o755);
  const env = join(dir, ".env");
  writeFileSync(env, `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${KEY}\n`);
  const run = (...a) => execFileSync("bash", [join(ROOT, "ops/supabase-setup.sh"), ...(a[0]?.startsWith("-") || !a.length ? [REF] : []), "--env", env, ...a], {
    encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { run, log: () => readFileSync(log, "utf8").trim().split("\n") };
}

test("dry run prints the plan and the dashboard checklist, runs nothing", () => {
  const s = setup({ code: 200, body: "{}" });
  const out = s.run();
  assert.match(out, /Dry run/);
  assert.match(out, /Email OTP expiration = 900 seconds/);
  assert.match(out, new RegExp(`https://${REF}.supabase.co/auth/v1/callback`));
  assert.throws(() => s.log(), "nothing ran");
});

test("--yes: link, push, test, bucket create + private check; re-run treats an existing bucket as fine", () => {
  for (const reply of [{ code: 200, body: "{}" }, { code: 400, body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}' }]) {
    const s = setup(reply);
    const out = s.run("--yes");
    assert.match(out, reply.code === 200 ? /created/ : /exists/);
    assert.match(out, /private: yes/);
    const calls = s.log().filter((l) => !l.startsWith("supabase init"));
    assert.deepEqual(calls, [
      `supabase link --project-ref ${REF}`, "supabase db push", "supabase test db --linked",
      `curl POST https://${REF}.supabase.co/storage/v1/bucket`, `curl PUT https://${REF}.supabase.co/storage/v1/bucket/scan`,
      `curl GET https://${REF}.supabase.co/storage/v1/bucket/scan`]);
  }
});

test("rejects a bad ref and a URL for another project", () => {
  const s = setup({ code: 200, body: "{}" });
  assert.throws(() => execFileSync("bash", [join(ROOT, "ops/supabase-setup.sh"), "nope"], { stdio: "pipe" }), /status 2|Command failed/);
  assert.throws(() => s.run("zzzzzzzzzzzzzzzzzzzz", "--yes"), (e) => /is not project zzzz/.test(e.stderr));
  assert.throws(() => s.log(), "nothing ran");
});
