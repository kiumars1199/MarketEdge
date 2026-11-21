// docs/15: the Free tier's 15-min delay holds on a cold serverless instance (nothing in memory): the store reads the
// `*-prev.json` copy the publisher keeps (ops/upload.py, refresh.yml), and never falls through to the live scan.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tier: "free" as "free" | "pro" }));
// T-276: authEnabled false = accounts off, so /m and /event render the data path, not the signed-out teaser (test/teaser.test.ts)
vi.mock("@/lib/auth/server", () => ({ getMe: async () => ({ user: null, tier: h.tier }), getTier: async () => h.tier, authEnabled: () => false, getUser: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));   // page loads key the rate limit on it (RT3-02)

const FIX = path.resolve(__dirname, "fixtures");
const dir = mkdtempSync(path.join(tmpdir(), "me-delay-"));
const now = Math.floor(Date.now() / 1000);
const OLD = now - 3600, NEW = now - 60;   // newest scan is 1 minute old

const withScan = (file: string, at: number, out = file) => {
  const j = JSON.parse(readFileSync(path.join(FIX, file), "utf8"));
  j.meta.scanned_at = at;
  if (file === "flags.json") j.flags[0].best.roi_pct = at === NEW ? 77.7 : j.flags[0].best.roi_pct;   // marks the live copy
  writeFileSync(path.join(dir, out), JSON.stringify(j));
};
for (const f of ["model.json", "backtest.json"]) copyFileSync(path.join(FIX, f), path.join(dir, f));
withScan("markets.json", NEW);
withScan("flags.json", NEW);

const saved = process.env.DATA_DIR;
process.env.DATA_DIR = dir;
const { DelayedPending, getStoreFor } = await import("@/lib/data/store");
const { GET: flags } = await import("@/app/api/flags/route");
const { GET: meta } = await import("@/app/api/meta/route");
const { DELAYED_PENDING, delayedPendingLine } = await import("@/lib/api");
const { ErrorState } = await import("@/components/screener/States");
const { default: About } = await import("@/app/about/page");
const { default: MarketPage } = await import("@/app/m/[id]/page");
const { default: EventPage } = await import("@/app/event/[id]/page");
const { default: StatusPage } = await import("@/app/status/page");
/** A cold instance: the module-level store state starts empty. */
const cold = () => {
  const s = (globalThis as { __meStore?: Record<string, unknown> }).__meStore ?? {};
  for (const k of Object.keys(s)) delete s[k];
};
afterAll(() => { process.env.DATA_DIR = saved; rmSync(dir, { recursive: true, force: true }); cold(); });
beforeEach(() => { cold(); h.tier = "free"; });

describe("Free delay on a cold instance", () => {
  it("serves the published previous scan, not the live one", async () => {
    withScan("markets.json", OLD, "markets-prev.json");
    withScan("flags.json", OLD, "flags-prev.json");
    expect((await getStoreFor("free")).meta.scanned_at).toBe(OLD);
    expect((await getStoreFor("pro")).meta.scanned_at).toBe(NEW);
    const body = await (await flags(new Request("http://t/api/flags"))).json();
    expect(JSON.stringify(body)).not.toContain("77.7");
  });

  // AUDIT run 3 fail 1: the freshness pill and "Scanned N ago" read /api/meta; it must date the scan each tier is served.
  it("/api/meta: Free gets the delayed scan's scanned_at and delay, paid the newest; never shared-cacheable", async () => {
    withScan("markets.json", OLD, "markets-prev.json");
    withScan("flags.json", OLD, "flags-prev.json");
    const free = await meta();
    const fb = await free.json();
    expect(fb.meta.scanned_at).toBe(OLD);
    expect(fb.delay_min).toBe(15);
    expect(free.headers.get("cache-control")).toMatch(/private|no-store/);
    expect(free.headers.get("vary")).toMatch(/Cookie/);
    h.tier = "pro";
    const pb = await (await meta()).json();
    expect(pb.meta.scanned_at).toBe(NEW);
    expect(pb.delay_min).toBe(0);
  });

  it("/api/meta: Free with no delayed copy gets 503 pending, not the live scan's time", async () => {
    rmSync(path.join(dir, "markets-prev.json"), { force: true });
    rmSync(path.join(dir, "flags-prev.json"), { force: true });
    const res = await meta();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe(DELAYED_PENDING);
  });

  it("fails closed (503) when there is no previous scan, instead of serving live data", async () => {
    rmSync(path.join(dir, "markets-prev.json"), { force: true });
    rmSync(path.join(dir, "flags-prev.json"), { force: true });
    await expect(getStoreFor("free")).rejects.toBeInstanceOf(DelayedPending);
    expect((await flags(new Request("http://t/api/flags"))).status).toBe(503);
    expect((await getStoreFor("premium")).meta.scanned_at).toBe(NEW);
  });

  it("refuses a *-prev.json that is not older than the newest scan", async () => {
    withScan("markets.json", NEW, "markets-prev.json");
    withScan("flags.json", NEW, "flags-prev.json");
    await expect(getStoreFor("free")).rejects.toBeInstanceOf(DelayedPending);
  });
});

// AUDIT run 2 fail 1: right after a fresh scan with no *-prev.json, Free gets an honest "first update shortly"
// state on every page and a 503 with a clear body from the API; paid tiers keep live data; nothing 500s.
describe("Free delay with no delayed copy yet", () => {
  const LINE = delayedPendingLine(15);
  const none = () => {
    rmSync(path.join(dir, "markets-prev.json"), { force: true });
    rmSync(path.join(dir, "flags-prev.json"), { force: true });
  };

  it("getStoreFor throws DelayedPending (missing and not-older); paid tiers get live", async () => {
    none();
    await expect(getStoreFor("free")).rejects.toBeInstanceOf(DelayedPending);
    withScan("markets.json", NEW, "markets-prev.json");
    withScan("flags.json", NEW, "flags-prev.json");
    await expect(getStoreFor("free")).rejects.toBeInstanceOf(DelayedPending);
    expect((await getStoreFor("pro")).meta.scanned_at).toBe(NEW);
  });

  it("API: 503 with the code, the honest line and Retry-After", async () => {
    none();
    const res = await flags(new Request("http://t/api/flags"));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ error: LINE, code: DELAYED_PENDING });
  });

  it("/about, /m/[id], /event/[id] render the pending state, not a crash", async () => {
    none();
    const pages = [
      About(),
      MarketPage({ params: Promise.resolve({ id: "6674492" }), searchParams: Promise.resolve({}) }),
      EventPage({ params: Promise.resolve({ id: "1313371" }) }),
    ];
    for (const p of pages) {
      const out = renderToStaticMarkup((await p) as ReactElement);
      expect(out).toContain(LINE);
      expect(out).toContain("/pricing");
    }
  });

  it("screeners show the pending state for the pending error, the generic error otherwise", () => {
    const pending = renderToStaticMarkup(createElement(ErrorState, { onRetry: () => {}, error: `pending: ${LINE}` }));
    expect(pending).toContain(LINE);
    expect(pending).not.toContain("Couldn");
    expect(renderToStaticMarkup(createElement(ErrorState, { onRetry: () => {}, error: "/api/flags: HTTP 500" }))).toContain("Couldn");
  });
});

// RT3-03: the delay was "one scan behind", not 15 minutes: a prev copy merely older than the newest scan was served
// even when seconds old. Free now gets the newest scan at least the delay old: the newest itself, *-prev.json or
// *-prev2.json (the publishers keep two, since at a 10-minute cadence the replaced scan is only ~10 min old).
describe("RT3-03: the Free copy is at least the delay old", () => {
  const TEN = now - 600;
  const rm = (...f: string[]) => f.forEach((x) => rmSync(path.join(dir, x), { force: true }));
  afterAll(() => rm("markets-prev2.json", "flags-prev2.json"));

  it("a prev copy younger than the delay is not served: pending, never the young copy", async () => {
    rm("markets-prev2.json", "flags-prev2.json");
    withScan("markets.json", TEN, "markets-prev.json");
    withScan("flags.json", TEN, "flags-prev.json");
    await expect(getStoreFor("free")).rejects.toBeInstanceOf(DelayedPending);
    expect((await meta()).status).toBe(503);
  });

  it("serves *-prev2.json when prev is too young; /api/meta dates that copy", async () => {
    withScan("markets.json", TEN, "markets-prev.json");
    withScan("flags.json", TEN, "flags-prev.json");
    withScan("markets.json", OLD, "markets-prev2.json");
    withScan("flags.json", OLD, "flags-prev2.json");
    expect((await getStoreFor("free")).meta.scanned_at).toBe(OLD);
    expect((await (await meta()).json()).meta.scanned_at).toBe(OLD);
    expect((await getStoreFor("pro")).meta.scanned_at).toBe(NEW);
  });

  it("prefers the newer copy once it is old enough", async () => {
    const SIXTEEN = now - 16 * 60;
    withScan("markets.json", SIXTEEN, "markets-prev.json");
    withScan("flags.json", SIXTEEN, "flags-prev.json");
    withScan("markets.json", OLD, "markets-prev2.json");
    withScan("flags.json", OLD, "flags-prev2.json");
    expect((await getStoreFor("free")).meta.scanned_at).toBe(SIXTEEN);
  });
});

// RT3-07: /status showed Free / signed-out the live scan's time and counts; it now dates the copy that tier is served.
describe("RT3-07: /status follows the tier's copy", () => {
  const stamp = (unix: number) => new Date(unix * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  it("Free sees the delayed scan's time, Pro the newest", async () => {
    withScan("markets.json", OLD, "markets-prev.json");
    withScan("flags.json", OLD, "flags-prev.json");
    const free = renderToStaticMarkup((await StatusPage()) as ReactElement);
    expect(free).toContain(stamp(OLD));
    expect(free).not.toContain(stamp(NEW));
    h.tier = "pro";
    expect(renderToStaticMarkup((await StatusPage()) as ReactElement)).toContain(stamp(NEW));
  });
});
