// docs/15 § Headers, against `next start`: security headers on every page, a strict per-request CSP whose
// nonce Next stamps on its scripts, and a page that still hydrates with no CSP violations.
import { expect, test } from "@playwright/test";

test("security headers and a strict nonce CSP", async ({ request }) => {
  const a = await request.get("/");
  const h = a.headers();
  expect(h["strict-transport-security"]).toMatch(/max-age=\d{8}; includeSubDomains/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["permissions-policy"]).toContain("camera=()");
  expect(h["x-powered-by"]).toBeUndefined();

  const policy = h["content-security-policy"]!;
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const nonce = policy.match(/'nonce-([^']+)'/)![1]!;
  const html = await a.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(s, s).toContain(`nonce="${nonce}"`);

  const b = await request.get("/");
  expect(b.headers()["content-security-policy"]).not.toContain(nonce);   // fresh nonce per request
  for (const p of ["/about", "/pricing", "/api/meta"]) expect((await request.get(p)).headers()["x-frame-options"], p).toBe("DENY");
});

// T-295: prerendered signed-out pages are one HTML file for everyone, so no nonce: a static CSP instead (owner sign-off
// in docs/overhaul-evidence/C/NOTES.md), and a public cache header the edge can keep.
test("prerendered pages: static CSP and a shared cache header", async ({ request }) => {
  for (const p of ["/pricing", "/about", "/terms"]) {
    const h = (await request.get(p)).headers();
    const policy = h["content-security-policy"]!;
    expect(policy, p).toContain("frame-ancestors 'none'");
    expect(policy, p).toContain("object-src 'none'");
    expect(policy, p).not.toContain("unsafe-eval");
    expect(policy, p).not.toContain("nonce-");
    expect(policy, p).not.toContain("strict-dynamic");
    expect(policy, p).toMatch(/script-src 'self' 'unsafe-inline'/);
    expect(h["x-frame-options"], p).toBe("DENY");
    expect(h["cache-control"], p).toMatch(/^s-maxage=300, stale-while-revalidate/);
  }
});

test("pages hydrate under the CSP", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await page.goto("/");
  await expect(page.locator("[data-row]").first()).toBeVisible();
  await page.goto("/pricing");
  await page.waitForLoadState("networkidle");
  expect(violations).toEqual([]);
});
