// T-295: signed-out pages are prerendered (static + ISR); middleware.ts sends signed-in and demo visitors elsewhere
// (lib/static-routes.ts), picks the CSP each kind of response can carry, and /api/revalidate refreshes them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeFor, SIGNED_IN_PREFIX, STATIC_PAGES, TWINNED } from "@/lib/static-routes";

const q = (s = "") => new URLSearchParams(s);
const ctx = (p: string, o: Partial<Parameters<typeof routeFor>[0]> = {}) =>
  routeFor({ path: p, search: q(), demo: false, auth: true, signedIn: false, ...o });

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@supabase/ssr");
  vi.doUnmock("@/lib/maintenance");
  vi.doUnmock("@/lib/config");
  vi.doUnmock("next/cache");
  vi.unstubAllEnvs();
});

describe("routeFor", () => {
  it("signed out: every static page is the prerendered one, whatever the query on /", () => {
    for (const p of STATIC_PAGES) expect(ctx(p), p).toEqual({ rewrite: null, prerendered: true });
    expect(ctx("/", { search: q("utm_source=x&cat=sports") })).toEqual({ rewrite: null, prerendered: true });
  });

  it("signed in: / is Best bets, per-user pages go to their dynamic twin, legal pages stay prerendered", () => {
    expect(ctx("/", { signedIn: true })).toEqual({ rewrite: "/bets", prerendered: false });
    for (const p of TWINNED) expect(ctx(p, { signedIn: true })).toEqual({ rewrite: SIGNED_IN_PREFIX + p, prerendered: false });
    expect(ctx("/terms", { signedIn: true })).toEqual({ rewrite: null, prerendered: true });
  });

  it("demo: / is Best bets; the other pages are prerendered for the demo user", () => {
    expect(ctx("/", { demo: true })).toEqual({ rewrite: "/bets", prerendered: false });
    expect(ctx("/pricing", { demo: true, signedIn: true })).toEqual({ rewrite: null, prerendered: true });
  });

  it("no accounts configured: a product query on / is the Free Best bets, as before", () => {
    expect(ctx("/", { auth: false, search: q("t=1") })).toEqual({ rewrite: "/bets", prerendered: false });
    expect(ctx("/", { auth: false, search: q("utm_source=x") })).toEqual({ rewrite: null, prerendered: true });
  });

  it("other pages pass through", () => {
    for (const p of ["/bets", "/m/1", "/pricing/x", "/account"]) expect(ctx(p, { signedIn: true })).toEqual({ rewrite: null, prerendered: false });
  });
});

describe("page files", () => {
  const src = (route: string) => readFileSync(path.resolve(import.meta.dirname, "../app", `.${route === "/" ? "" : route}`, "page.tsx"), "utf8");
  it("every STATIC_PAGES page is force-static with a 300 s revalidate; every twin is force-dynamic", () => {
    for (const p of STATIC_PAGES) {
      expect(src(p), p).toMatch(/export const dynamic = "force-static"/);
      expect(src(p), p).toMatch(/export const revalidate = 300;/);
    }
    for (const p of TWINNED) {
      const twin = src(SIGNED_IN_PREFIX + p);
      expect(twin).toMatch(/export const dynamic = "force-dynamic"/);
      expect(twin).toContain(`from "../..${p}/page"`);
    }
  });
});

const USER = { id: "u1", email: "a@example.com", email_confirmed_at: "x" };
async function mw(url: string, { user = null as typeof USER | null, demo = false } = {}) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.doMock("@/lib/config", async (orig) => ({ ...(await orig<object>()), DEMO_MODE: demo }));
  vi.doMock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: {
    getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: null } }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) },
  } }) }));
  vi.doMock("@/lib/maintenance", () => ({ maintenanceOn: async () => false }));
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("@/middleware");
  return middleware(new NextRequest(url));
}
const rewrite = (r: Response) => r.headers.get("x-middleware-rewrite") && new URL(r.headers.get("x-middleware-rewrite")!).pathname;
const scriptSrc = (r: Response) => r.headers.get("content-security-policy")!.split("; ").find((d) => d.startsWith("script-src "))!;

describe("middleware.ts", () => {
  it("signed out /: the prerendered landing with the static CSP (no nonce, no 'strict-dynamic')", async () => {
    const r = await mw("http://t/");
    expect(r.status).toBe(200);
    expect(rewrite(r)).toBeFalsy();
    expect(scriptSrc(r)).not.toMatch(/nonce-|strict-dynamic/);
    expect(scriptSrc(r)).toContain("'unsafe-inline'");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("signed in: / → /bets and /pricing → its twin, both with a nonce", async () => {
    for (const [from, to] of [["/", "/bets"], ["/pricing", "/signed-in/pricing"], ["/track-record", "/signed-in/track-record"]]) {
      vi.resetModules();
      const r = await mw(`http://t${from}`, { user: USER });
      expect(rewrite(r), from).toBe(to);
      expect(scriptSrc(r)).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
      expect(scriptSrc(r)).not.toContain("'unsafe-inline'");
    }
  });

  it("dynamic pages keep the nonce CSP; a direct request for a twin is a 404", async () => {
    const r = await mw("http://t/bets", { user: USER });
    expect(scriptSrc(r)).toMatch(/nonce-/);
    vi.resetModules();
    expect((await mw("http://t/signed-in/pricing", { user: USER })).status).toBe(404);
  });

  it("demo: / → /bets", async () => {
    expect(rewrite(await mw("http://t/", { demo: true }))).toBe("/bets");
  });
});

describe("POST /api/revalidate", () => {
  const post = (auth?: string) => new Request("http://t/api/revalidate", { method: "POST", headers: { "user-agent": "python-requests/2.32", ...(auth ? { authorization: auth } : {}) } });

  it("401 without the secret (and when none is configured); 200 revalidates every static page", async () => {
    const revalidatePath = vi.fn();
    vi.doMock("next/cache", () => ({ revalidatePath }));
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("REVALIDATE_SECRET", "");
    let { POST } = await import("@/app/api/revalidate/route");
    expect((await POST(post("Bearer "))).status).toBe(401);
    vi.resetModules();
    vi.stubEnv("REVALIDATE_SECRET", "r3v");
    ({ POST } = await import("@/app/api/revalidate/route"));
    expect((await POST(post())).status).toBe(401);
    expect((await POST(post("Bearer nope"))).status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
    const ok = await POST(post("Bearer r3v"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([...STATIC_PAGES]);
  });

  it("falls back to CRON_SECRET", async () => {
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
    vi.stubEnv("REVALIDATE_SECRET", "");
    vi.stubEnv("CRON_SECRET", "cr0n");
    const { POST } = await import("@/app/api/revalidate/route");
    expect((await POST(post("Bearer cr0n"))).status).toBe(200);
  });

  it("is outside the middleware matcher (no session, no account wall), like the Stripe webhook", async () => {
    const { config } = await import("@/middleware");
    expect(config.matcher[0]).toContain("api/revalidate");
  });
});
