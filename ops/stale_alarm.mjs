// Stale-data alarm (docs/OVERHAUL.md §F2, T-298). Run every 15 min by .github/workflows/stale-alarm.yml.
// Reads /api/meta on the live site and emails the owners through Resend when the scan is older than
// STALE_AFTER_MIN (45) or the site errors. One email when an incident opens, one all-clear when it closes;
// nothing in between, even if the incident changes shape (stale → site down → stale is one incident).
//
//   node ops/stale_alarm.mjs [--state .stale-alarm/state.json] [--site https://kismetodds.com]
//
// Env: RESEND_API_KEY, ALARM_EMAIL_FROM (or EMAIL_FROM), ALARM_EMAIL_TO (default kismetodds@gmail.com), SITE_URL.
// Exit 0 = state is current; exit 1 = an email was due and could not be sent (state left unchanged, so the next run
// tries again, and the failed workflow run itself notifies the repo owner).
//
// Why the raw age of the anonymous /api/meta: signed out, the site serves the newest scan that is at least the Free
// delay (15 min) old (apps/web/lib/data/store.ts getStoreFor). Healthy (engine scanning every 2 min) that copy is
// 15-32 min old. Once the engine has stalled for more than 15 min, the newest scan itself is the one served, so the
// raw age IS the live scan's age from there on: "older than 45 min" here means the live scan is older than 45 min.
// Node 22+, no dependencies.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const STALE_AFTER_MIN = 45;
export const DEFAULT_SITE = "https://kismetodds.com";
export const DEFAULT_TO = "kismetodds@gmail.com";
const FUTURE_SLACK_SEC = 300;   // clock skew allowed before a scanned_at in the future counts as broken data

/** One look at the site: fresh, stale or error. Retries errors (cold starts take ~5 s) before calling it an error. */
export async function checkSite(site, { fetchImpl = fetch, now = Date.now, attempts = 3, timeoutMs = 25_000, sleep = defaultSleep, waitMs = 10_000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(waitMs);
    last = await lookOnce(site, fetchImpl, now, timeoutMs);
    if (last.kind !== "error") return last;
  }
  return last;
}

async function lookOnce(site, fetchImpl, now, timeoutMs) {
  const url = `${site.replace(/\/+$/, "")}/api/meta`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "kismet-stale-alarm" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { kind: "error", detail: `request failed: ${e?.name === "TimeoutError" ? `no answer in ${timeoutMs / 1000} s` : e?.message ?? e}` };
  }
  if (!res.ok) return { kind: "error", detail: `HTTP ${res.status} from /api/meta` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { kind: "error", detail: "/api/meta did not return JSON" };
  }
  const at = body?.meta?.scanned_at;
  const nowSec = now() / 1000;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return { kind: "error", detail: "/api/meta has no valid meta.scanned_at" };
  if (at > nowSec + FUTURE_SLACK_SEC) return { kind: "error", detail: `meta.scanned_at is in the future (${new Date(at * 1000).toISOString()})` };
  const ageMin = Math.max(0, Math.round((nowSec - at) / 60));
  return ageMin > STALE_AFTER_MIN
    ? { kind: "stale", ageMin, scannedAt: at, detail: `the scan the site serves is ${ageMin} min old (limit ${STALE_AFTER_MIN})` }
    : { kind: "fresh", ageMin, scannedAt: at, detail: `scan is ${ageMin} min old` };
}

/** Pure state machine. state = { incident: null | { since, kind, detail } }. Returns the next state and the email due. */
export function decide(state, look, nowMs) {
  const open = state?.incident ?? null;
  const bad = look.kind !== "fresh";
  if (bad && !open) return { next: { incident: { since: nowMs, kind: look.kind, detail: look.detail } }, email: "alert" };
  if (!bad && open) return { next: { incident: null, last: { since: open.since, ended: nowMs } }, email: "clear" };
  return { next: state ?? { incident: null }, email: null };
}

const dur = (ms) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function composeEmail(kind, look, site, incident, nowMs) {
  if (kind === "alert") {
    const what = look.kind === "stale" ? `Kismet data is stale: ${look.ageMin} min old` : "Kismet site error";
    return {
      subject: `[Kismet alarm] ${what}`,
      text: [
        `${what}.`, "", `Check: ${site}/api/meta`, `Detail: ${look.detail}`, `Seen at: ${new Date(nowMs).toISOString()}`, "",
        "Look at the engine (Railway logs, ops/scheduler.py) and the last upload (ops/upload.py). The refresh workflow on GitHub is the fallback.",
        "You get one email per incident and one all-clear when it is over.",
      ].join("\n"),
    };
  }
  return {
    subject: `[Kismet alarm] All clear: data is ${look.ageMin} min old`,
    text: [
      `All clear. ${site}/api/meta answers and the scan is ${look.ageMin} min old.`,
      incident ? `The incident lasted about ${dur(nowMs - incident.since)} (from ${new Date(incident.since).toISOString()}).` : "",
    ].filter(Boolean).join("\n"),
  };
}

/** POST to Resend. Throws on anything but 2xx; the response body is not echoed (it can repeat the address). */
export async function sendResend({ key, from, to, subject, text }, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
}

export function readState(file) {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    return s && typeof s === "object" ? s : { incident: null };
  } catch {
    return { incident: null };   // first run, or the cache was evicted: worst case one repeated alert, never a missed one
  }
}

export function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** One run: look, decide, send, and only after a 2xx from Resend, persist the new state. */
export async function runOnce({ stateFile, site = DEFAULT_SITE, env = process.env, fetchImpl = fetch, now = Date.now, log = console.log, sleep = defaultSleep } = {}) {
  const state = readState(stateFile);
  const look = await checkSite(site, { fetchImpl, now, sleep });
  const nowMs = now();
  const { next, email } = decide(state, look, nowMs);
  log(`[stale-alarm] ${look.kind}: ${look.detail}; incident ${state.incident ? "open" : "none"} → ${next.incident ? "open" : "none"}${email ? `; email: ${email}` : ""}`);
  if (email) {
    const key = env.RESEND_API_KEY;
    const from = env.ALARM_EMAIL_FROM || env.EMAIL_FROM;
    if (!key || !from) {
      log("[stale-alarm] RESEND_API_KEY / ALARM_EMAIL_FROM not set: can't email. State unchanged; failing so GitHub notifies.");
      return { exitCode: 1, look, email, sent: false };
    }
    const msg = composeEmail(email, look, site, state.incident, nowMs);
    try {
      await sendResend({ key, from, to: env.ALARM_EMAIL_TO || DEFAULT_TO, ...msg }, fetchImpl);
    } catch (e) {
      log(`[stale-alarm] email failed (${e?.message ?? e}). State unchanged; the next run tries again.`);
      return { exitCode: 1, look, email, sent: false };
    }
  }
  writeState(stateFile, next);
  return { exitCode: 0, look, email, sent: !!email };
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
  };
  const { exitCode } = await runOnce({ stateFile: arg("state", ".stale-alarm/state.json"), site: arg("site", process.env.SITE_URL || DEFAULT_SITE) });
  process.exit(exitCode);
}
