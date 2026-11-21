// ops/stale_alarm.mjs (T-298): consecutive runs share one state file, exactly as the workflow's cache carries it.
// fetch is mocked for both /api/meta and Resend: nothing leaves the machine and no real email is ever sent.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { STALE_AFTER_MIN, decide, readState, runOnce } from "../stale_alarm.mjs";

const SITE = "https://kismetodds.test";
const ENV = { RESEND_API_KEY: "re_test", ALARM_EMAIL_FROM: "Kismet alarm <alarm@kismetodds.test>" };

/** A fake site + fake Resend. `site` is what /api/meta does next: { age } minutes, { status }, { throws }, { body }. */
function world() {
  const w = { clock: Date.parse("2026-11-20T03:00:00Z"), site: { age: 3 }, emails: [], resendFails: 0, metaCalls: 0 };
  w.now = () => w.clock;
  w.fetch = async (url, init = {}) => {
    if (url === "https://api.resend.com/emails") {
      assert.equal(init.method, "POST");
      if (w.resendFails > 0) { w.resendFails--; return new Response("{}", { status: 500 }); }
      w.emails.push(JSON.parse(init.body));
      return Response.json({ id: `email_${w.emails.length}` });
    }
    assert.equal(url, `${SITE}/api/meta`);
    w.metaCalls++;
    const s = w.site;
    if (s.throws) throw new TypeError("fetch failed");
    if (s.status) return new Response("oops", { status: s.status });
    if (s.body !== undefined) return Response.json(s.body);
    return Response.json({ meta: { scanned_at: w.clock / 1000 - s.age * 60 }, delay_min: 15 });
  };
  w.run = () => runOnce({ stateFile: w.file, site: SITE, env: ENV, fetchImpl: w.fetch, now: w.now, log: () => {}, sleep: async () => {} });
  w.tick = () => { w.clock += 15 * 60_000; return w.run(); };
  w.file = join(mkdtempSync(join(tmpdir(), "stale-alarm-")), "state.json");
  return w;
}

test("a stale timestamp across several consecutive runs sends exactly one alert, recovery exactly one all-clear", async () => {
  const w = world();
  for (let i = 0; i < 3; i++) await w.tick();                     // healthy: 3 min old
  assert.equal(w.emails.length, 0);

  w.site = { age: STALE_AFTER_MIN + 1 };                           // forced stale
  for (let i = 0; i < 6; i++) {                                    // 6 runs = 90 min of a stale site
    const r = await w.tick();
    assert.equal(r.exitCode, 0);
    w.site = { age: w.site.age + 15 };                             // and it keeps getting older
  }
  assert.equal(w.emails.length, 1, "one alert for the whole incident");
  assert.match(w.emails[0].subject, /stale: 46 min old/);
  assert.deepEqual(w.emails[0].to, ["kismetodds@gmail.com"]);
  assert.equal(readState(w.file).incident.kind, "stale");

  w.site = { age: 2 };                                             // engine back
  for (let i = 0; i < 4; i++) await w.tick();
  assert.equal(w.emails.length, 2, "one all-clear, then silence");
  assert.match(w.emails[1].subject, /All clear: data is 2 min old/);
  assert.match(w.emails[1].text, /lasted about 1 h 30 min/);
  assert.equal(readState(w.file).incident, null);
});

test("45 min exactly is fine; 46 is stale", async () => {
  const w = world();
  w.site = { age: 45 };
  assert.equal((await w.run()).look.kind, "fresh");
  w.site = { age: 46 };
  assert.equal((await w.run()).look.kind, "stale");
});

test("site error path: HTTP 500 / network failure over consecutive runs is one alert, recovery one all-clear", async () => {
  const w = world();
  w.site = { status: 500 };
  await w.tick();
  w.site = { throws: true };
  await w.tick();
  w.site = { status: 503 };
  await w.tick();
  assert.equal(w.emails.length, 1);
  assert.match(w.emails[0].subject, /site error/);
  assert.match(w.emails[0].text, /HTTP 500/);
  w.site = { age: 5 };
  await w.tick();
  await w.tick();
  assert.equal(w.emails.length, 2);
  assert.match(w.emails[1].subject, /All clear/);
});

test("stale → site down → stale is still one incident (one alert, one all-clear)", async () => {
  const w = world();
  for (const s of [{ age: 60 }, { status: 502 }, { throws: true }, { age: 90 }, { age: 4 }]) { w.site = s; await w.tick(); }
  assert.deepEqual(w.emails.map((e) => e.subject.replace(/:.*/, "")), ["[Kismet alarm] Kismet data is stale", "[Kismet alarm] All clear"]);
});

test("errors are retried within a run before they count: a cold start that answers on the 2nd try is not an incident", async () => {
  const w = world();
  let calls = 0;
  const flaky = async (url, init) => (url.endsWith("/api/meta") && ++calls === 1 ? new Response("", { status: 504 }) : w.fetch(url, init));
  const r = await runOnce({ stateFile: w.file, site: SITE, env: ENV, fetchImpl: flaky, now: w.now, log: () => {}, sleep: async () => {} });
  assert.equal(r.look.kind, "fresh");
  assert.equal(w.emails.length, 0);
  w.site = { status: 500 };
  await w.run();
  assert.equal(w.metaCalls, 1 + 3, "a real outage is tried 3 times before alerting");
});

test("missing, NaN or future scanned_at is an error, never healthy", async () => {
  for (const body of [{}, { meta: {} }, { meta: { scanned_at: "x" } }, { meta: { scanned_at: null } }]) {
    const w = world();
    w.site = { body };
    assert.equal((await w.run()).look.kind, "error", JSON.stringify(body));
  }
  const w = world();
  w.site = { body: { meta: { scanned_at: w.clock / 1000 + 3600 } } };
  const r = await w.run();
  assert.equal(r.look.kind, "error");
  assert.match(r.look.detail, /future/);
});

test("Resend failing: state is not advanced, the run fails, and the next run delivers the one alert", async () => {
  const w = world();
  w.site = { age: 120 };
  w.resendFails = 1;
  const first = await w.tick();
  assert.equal(first.exitCode, 1);
  assert.equal(w.emails.length, 0);
  assert.equal(readState(w.file).incident, null, "no state written after a failed send");
  const second = await w.tick();
  assert.equal(second.exitCode, 0);
  await w.tick();
  assert.equal(w.emails.length, 1, "still exactly one delivered alert");
});

test("no Resend key: an incident fails the run loudly and keeps state; a healthy site needs no key", async () => {
  const w = world();
  const quiet = (env) => runOnce({ stateFile: w.file, site: SITE, env, fetchImpl: w.fetch, now: w.now, log: () => {}, sleep: async () => {} });
  assert.equal((await quiet({})).exitCode, 0);
  w.site = { status: 500 };
  assert.equal((await quiet({})).exitCode, 1);
  assert.equal(readState(w.file).incident, null);
});

test("decide() is a pure state machine", () => {
  const t = 1;
  assert.deepEqual(decide({ incident: null }, { kind: "fresh" }, t).email, null);
  assert.equal(decide({ incident: null }, { kind: "stale", detail: "d" }, t).email, "alert");
  assert.equal(decide({ incident: { since: 0 } }, { kind: "error" }, t).email, null);
  assert.equal(decide({ incident: { since: 0 } }, { kind: "fresh" }, t).email, "clear");
  assert.equal(decide(undefined, { kind: "error", detail: "d" }, t).email, "alert");
});
