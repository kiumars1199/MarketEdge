import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("robots.txt and sitemap.xml (T-76)", () => {
  const rules = [robots().rules].flat();
  it("blocks AI crawlers everywhere and keeps search engines out of the app and API", () => {
    const ai = rules.find((r) => [r.userAgent].flat().includes("GPTBot"))!;
    for (const bot of ["ClaudeBot", "CCBot", "PerplexityBot", "Google-Extended", "Bytespider"]) expect([ai.userAgent].flat()).toContain(bot);
    expect(ai.disallow).toBe("/");
    const all = rules.find((r) => r.userAgent === "*")!;
    expect(all.disallow).toEqual(expect.arrayContaining(["/api/", "/account", "/login", "/reset-password"]));
  });
  it("lists public pages only", () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    expect(urls).toEqual(expect.arrayContaining(["/", "/pricing", "/terms", "/privacy", "/refunds", "/disclaimer", "/contact"]));
    for (const u of urls) expect(["/api", "/account", "/login", "/reset-password", "/settings", "/journal"].some((p) => u.startsWith(p))).toBe(false);
  });
  it("lists every static public page in app/ (audit fail 10)", () => {
    const disallow = [rules.find((r) => r.userAgent === "*")!.disallow ?? []].flat();
    const NOT_FOR_SEARCH = ["/maintenance", "/ext/connect", "/e2e-mock", "/signed-in"];   // noindex, extension handshake, test mock, T-295 rewrite targets (404 direct)
    const app = path.resolve(import.meta.dirname, "../app");
    const pages = (readdirSync(app, { recursive: true }) as string[])
      .filter((f) => /(^|\/)page\.tsx$/.test(f) && !f.includes("["))
      .map((f) => "/" + path.dirname(f).replace(/^\.$/, "").split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join("/"))
      .filter((p) => !disallow.some((d) => p === d.replace(/\/$/, "") || p.startsWith(d.endsWith("/") ? d : `${d}/`)))
      .filter((p) => !NOT_FOR_SEARCH.some((x) => p.startsWith(x)));
    expect(pages).toContain("/about");
    for (const gated of ["/bets", "/markets", "/combos", "/tools", "/watchlist"]) expect(pages).not.toContain(gated);   // T-276: account-only
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    expect(urls.sort()).toEqual(pages.sort());
  });
  it("the sitemap lists only pages a signed-out visitor can open (T-276)", async () => {
    const { signedOutAccess } = await import("@/lib/auth/public-paths");
    for (const u of sitemap().map((e) => new URL(e.url).pathname || "/")) expect(signedOutAccess(u), u).toBe("public");
  });
  it("every page gets a 1200×630 share image: site default plus a large Twitter card (audit fail 11)", async () => {
    const og = await import("@/app/opengraph-image");
    const tw = await import("@/app/twitter-image");
    expect(og.size).toEqual({ width: 1200, height: 630 });
    expect(tw.default).toBe(og.default);
    const src = readFileSync(path.resolve(import.meta.dirname, "../app/layout.tsx"), "utf8");
    expect(src).toMatch(/twitter: \{ card: "summary_large_image"/);
    expect(src).toMatch(/openGraph: \{[^}]*images:/);
  });
  it("the market share card wraps instead of running off the 1200 px edge (audit run 2 fail 5)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../app/m/[id]/opengraph-image.tsx"), "utf8");
    expect(src).toMatch(/fontSize: 54[^}]*lineClamp: 3/);                       // question: 3 lines, then …
    expect(src).toMatch(/fontSize: 32[^}]*lineClamp: 2/);                       // the sign-up line wraps, 2 lines max
  });
  it("the market share card is the signed-out teaser: no model numbers (T-276)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../app/m/[id]/opengraph-image.tsx"), "utf8");
    expect(src).toMatch(/marketTeaser/);
    for (const k of ["sideRet", "betLine", "win_prob", "roi_pct", "getStoreFor", "gateMarket", "pct("]) expect(src).not.toContain(k);
  });
});
