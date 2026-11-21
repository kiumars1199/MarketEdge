// docs/15 controls that are plain logic or a grep over the source (Lane X). Evidence map: docs/SECURITY_EVIDENCE.md.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoFlag } from "@/lib/config";

describe("DEMO_MODE fails safe", () => {
  it("is on only when explicitly true, or unset outside production", () => {
    expect(demoFlag("true", "production")).toBe(true);
    expect(demoFlag(undefined, "production")).toBe(false);   // forgotten var on a production deploy
    expect(demoFlag("", "production")).toBe(false);
    expect(demoFlag("false", "development")).toBe(false);
    expect(demoFlag("1", "development")).toBe(false);
    expect(demoFlag(undefined, "development")).toBe(true);   // pnpm dev with no .env
    expect(demoFlag(undefined, "test")).toBe(true);
  });
});

describe("AI crawlers (docs/14 §6, docs/15 § Bots)", () => {
  it("middleware refuses AI user agents with 403, people pass", async () => {
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    const hit = (ua: string) => middleware(new NextRequest("http://t/api/markets", { headers: { "user-agent": ua } }));
    for (const ua of ["Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", "ClaudeBot/1.0", "CCBot/2.0", "PerplexityBot/1.0"])
      expect((await hit(ua)).status, ua).toBe(403);
    expect((await hit("Mozilla/5.0 (Macintosh) Chrome/131.0")).status).toBe(200);
  });

  it("robots.txt disallows every blocked crawler (same list as the middleware)", async () => {
    const { TRAINING_BOTS } = await import("@/lib/bots");
    const rules = [(await import("@/app/robots")).default().rules].flat();
    const blocked = rules.find((r) => r.disallow === "/" && !r.allow);
    expect(blocked?.userAgent).toEqual(TRAINING_BOTS);
    for (const b of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended"]) expect(TRAINING_BOTS).toContain(b);
  });

  it("T-281: robots.txt lets ChatGPT-User, Claude-User and Perplexity-User read the public pages only", async () => {
    const rules = [(await import("@/app/robots")).default().rules].flat();
    const users = rules.find((r) => [r.userAgent].flat().includes("Claude-User"))!;
    expect([users.userAgent].flat().sort()).toEqual(["ChatGPT-User", "Claude-User", "Perplexity-User"]);
    expect(users.disallow).toBe("/");
    expect([users.allow].flat()).toEqual(expect.arrayContaining(["/$", "/pricing", "/about", "/track-record", "/terms", "/privacy", "/llms.txt"]));
    for (const p of [users.allow].flat()) expect(p).not.toMatch(/^\/(api|account|bets|markets|m|watchlist|oauth)\b/);
    // no *-User agent sits in the training group, and no training crawler in the user group
    const training = rules.find((r) => r.disallow === "/" && !r.allow)!;
    for (const u of ["ChatGPT-User", "Claude-User", "Perplexity-User"]) expect([training.userAgent].flat()).not.toContain(u);
  });

  it("T-281: middleware lets user-triggered fetchers read public pages, blocks them elsewhere, blocks crawlers everywhere", async () => {
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    const hit = async (p: string, ua: string) => (await middleware(new NextRequest(`http://t${p}`, { headers: { "user-agent": ua } }))).status;
    const user = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-User/1.0; +Claude-User@anthropic.com";
    for (const ua of [user, "ChatGPT-User/1.0", "Perplexity-User/1.0"]) {
      for (const p of ["/", "/pricing", "/about", "/track-record", "/terms", "/llms.txt"]) expect(await hit(p, ua), `${ua} ${p}`).not.toBe(403);
      for (const p of ["/api/markets", "/api/flags", "/bets", "/m/1", "/account", "/watchlist"]) expect(await hit(p, ua), `${ua} ${p}`).toBe(403);
    }
    for (const ua of ["GPTBot/1.2", "ClaudeBot/1.0", "CCBot/2.0", "Google-Extended"]) {
      for (const p of ["/", "/pricing", "/track-record", "/llms.txt", "/api/markets"]) expect(await hit(p, ua), `${ua} ${p}`).toBe(403);
    }
    // the MCP endpoint and OAuth discovery are not refused by user agent (bearer token / public metadata)
    for (const p of ["/api/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"])
      expect(await hit(p, "ClaudeBot/1.0"), p).not.toBe(403);
  });
});

// ---------------------------------------------------------------- source greps (docs/15 § Web hardening)

const SRC = ["app", "lib", "components", "middleware.ts", "instrumentation-client.ts"];
const files = (): string[] =>
  SRC.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map((f) => join(p, String(f))) : [p]))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("web hardening greps", () => {
  it("no dangerouslySetInnerHTML anywhere", () => {
    expect(files().filter((f) => read(f).includes("dangerouslySetInnerHTML"))).toEqual([]);
  });

  it("server fetches only allow-listed hosts (plus Supabase from env)", () => {
    const ALLOWED = ["api.github.com", "api.resend.com", "clob.polymarket.com", "gamma-api.polymarket.com",
      "api.elections.kalshi.com", "demo-api.kalshi.co",   // Kalshi: combo quotes, only with KALSHI_DATA_PERMISSION
      "discord.com", "api.telegram.org",                  // alert webhooks: prefix re-checked by webhookUrl(), redirect: "error"
      "us.i.posthog.com"];                                // T-299 funnel steps sent server-side (lib/funnel-server.ts), only with the PostHog key
    const hosts = files().filter((f) => /\bfetch\(/.test(read(f)))
      .flatMap((f) => [...read(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => `${m[1]} (${f})`));
    expect(hosts.filter((h) => !ALLOWED.includes(h.split(" ")[0]!))).toEqual([]);
  });

  it("every mutating route checks Origin, or has a credential a browser can't forge", () => {
    const EXEMPT: Record<string, string> = {
      "app/api/stripe/webhook/route.ts": "Stripe signature",
      "app/api/unsubscribe/route.ts": "signed token, RFC 8058 one-click from the mail client",
      "app/api/ext/token/refresh/route.ts": "Bearer token, no cookies",
      "app/api/ext/telemetry/route.ts": "no auth, no state: logs a slug and a count",
      "app/api/trade/nonce/verify/route.ts": "the nonce is the credential",
      "app/api/alerts/run/route.ts": "CRON_SECRET",
      "app/api/settle/run/route.ts": "CRON_SECRET",
      "app/api/revalidate/route.ts": "REVALIDATE_SECRET or CRON_SECRET (T-295)",
      "app/api/mcp/route.ts": "OAuth bearer token only (lib/mcp/auth.ts), never cookies; read-only tools",
      "app/e2e-mock/[...path]/route.ts": "404 unless E2E_MOCK=1 outside production",
      "app/api/admin/export/route.ts": "GET only (sameSiteRequest); its POST/PUT/PATCH/DELETE are adminOnly405: 404 or 405, no state change",
    };
    const routes = files().filter((f) => f.endsWith("route.ts") && /export (async )?(function|const) (POST|PUT|PATCH|DELETE)\b/.test(read(f)));
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.filter((f) => !EXEMPT[f] && !/sameOrigin\(|siteOrExtension\(|withUser\(/.test(read(f)))).toEqual([]);
    for (const f of Object.keys(EXEMPT)) expect(existsSync(f), f).toBe(true);
  });

  it("every zod object that parses a request is .strict()", () => {
    const inputs = files().filter((f) => f.startsWith("app/api/") || f === "lib/kalshiCombo.ts" || f === "lib/trade/intent.ts" || f === "lib/repo/schemas.ts");
    const loose = inputs.filter((f) => count(read(f), /z\.object\(/g) !== count(read(f), /\.strict\(\)/g));
    expect(loose).toEqual([]);
    expect(inputs.reduce((n, f) => n + count(read(f), /\.strict\(\)/g), 0)).toBeGreaterThan(15);
  });
});

describe("alert webhooks (docs/15): Discord and Telegram URLs only", () => {
  it("accepts the two real prefixes, nothing else", async () => {
    const { ROW } = await import("@/lib/repo/schemas");
    const rule = { name: "r", enabled: true, kind: "closing_soon", query: null, market_id: null, side_index: null, threshold: null,
      channels: ["discord"], cooldown_minutes: 60, quiet_hours: null, last_fired_at: null };
    const ok = (webhook_url: string) => ROW.alert_rules.safeParse({ ...rule, webhook_url }).success;
    expect(ok("https://discord.com/api/webhooks/1/abc")).toBe(true);
    expect(ok("https://api.telegram.org/bot1:x/sendMessage")).toBe(true);
    for (const bad of ["https://evil.example/", "https://discord.com.evil.example/api/webhooks/x", "http://discord.com/api/webhooks/1",
      "https://discord.com/api/oauth2/x", "https://169.254.169.254/latest"]) expect(ok(bad), bad).toBe(false);
  });
});

describe("cookie flags (docs/15 § Auth)", () => {
  it("HttpOnly, SameSite=Lax, Secure in production, path /", async () => {
    const { COOKIE_OPTIONS } = await import("@/lib/auth/server");
    expect(COOKIE_OPTIONS).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    for (const f of ["lib/auth/server.ts", "middleware.ts"]) expect(read(f), f).toMatch(/secure: process\.env\.NODE_ENV === "production"/);
    expect(read("middleware.ts")).toMatch(/COOKIE_OPTIONS = \{ httpOnly: true, secure: [^}]+, sameSite: "lax" as const, path: "\/" \}/);
  });

  it("every cookie the server sets spreads COOKIE_OPTIONS last-or-only, and the browser sets none", () => {
    const sets = files().flatMap((f) => [...read(f).matchAll(/(\bjar|\bres\.cookies|\(await cookies\(\)\))\.set\(([^;]*)/g)].map((m) => [f, m[2]!] as const));
    expect(sets.length).toBeGreaterThanOrEqual(4);
    expect(sets.filter(([, args]) => !/COOKIE_OPTIONS/.test(args) || /COOKIE_OPTIONS\s*,\s*(httpOnly|secure|sameSite)/.test(args))).toEqual([]);
    expect(files().filter((f) => read(f).includes("document.cookie"))).toEqual([]);
  });
});

describe("Origin checks", () => {
  const post = (origin?: string, body = "{}") =>
    new Request("http://t/api/x", { method: "POST", body, headers: origin ? { origin } : {} });

  it("/api/settle refuses other sites and unknown keys", async () => {
    const { POST } = await import("@/app/api/settle/route");
    expect((await POST(post("https://evil.example"))).status).toBe(403);
    expect((await POST(post())).status).toBe(403);
    expect((await POST(post("http://t", JSON.stringify({ ids: ["1"], x: 1 })))).status).toBe(400);
  });

  it("/api/ext/token: our site or our extension only", async () => {
    const { siteOrExtension, extensionId } = await import("@/lib/trade/server");
    expect(siteOrExtension(post("http://t"))).toBe(true);
    expect(siteOrExtension(post(`chrome-extension://${extensionId()}`))).toBe(true);
    expect(siteOrExtension(post("chrome-extension://abcdefghijklmnopabcdefghijklmnop"))).toBe(false);
    expect(siteOrExtension(post("https://evil.example"))).toBe(false);
    const { POST } = await import("@/app/api/ext/token/route");
    expect((await POST(post("https://evil.example"))).status).toBe(403);
  });
});

describe("AI readers (T-281)", () => {
  it("/llms.txt is served as Markdown with the connector URL and the disclaimer", async () => {
    const res = await (await import("@/app/llms.txt/route")).GET();   // async since T-290 (it reads the track record)
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    const body = await res.text();
    expect(body).toMatch(/^# Kismet/);
    expect(body).toContain("/api/mcp");
    expect(body).toContain("Market analytics, not financial advice. Based on past results. 18+.");
  });
});
