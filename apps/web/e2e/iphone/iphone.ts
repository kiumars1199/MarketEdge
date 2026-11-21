// docs/OVERHAUL.md §D: shared iPhone checks, used by e2e/overhaul-iphone.spec.ts (demo app pages) and
// e2e-paid/overhaul-iphone.spec.ts (signed-out pages, which only exist with DEMO_MODE=false).
// Checks per page: no horizontal scroll, tap targets ≥ 44 px, the sticky header and bottom nav never cover content,
// and no loading flash (a list that showed rows never drops back to zero rows while the page settles).
import { expect, type Page, type TestInfo } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const SHOTS = path.resolve(__dirname, "../../../../docs/overhaul-evidence/D");

/** Watch for loading flashes from the first byte: if rows ([data-row]) or cards appear and then all vanish, that's a flash. */
export async function watchFlashes(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __flashes: string[]; __seen: number };
    w.__flashes = []; w.__seen = 0;
    const check = () => {
      const n = document.querySelectorAll("[data-row], [data-testid=bet-card]").length;
      if (n > 0) w.__seen = Math.max(w.__seen, n);
      else if (w.__seen > 0) { w.__flashes.push(`rows dropped from ${w.__seen} to 0 at ${Math.round(performance.now())} ms`); w.__seen = 0; }
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true });
  });
}

type Problem = string;

/** Tap targets: visible links, buttons, inputs, selects, summaries and role=button that aren't inline text links.
 *  WCAG 2.5.8 exempts links inside a sentence; we exempt `display: inline` anchors inside running text (p, li, dd, span
 *  inside p) only. Everything else must be ≥ 44 × 44 CSS px, counting its own padding. */
export async function smallTargets(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox]");
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.closest("[aria-hidden=true], [inert]")) continue;
      // a visually hidden skip link etc.
      if (r.width <= 1 && r.height <= 1) continue;
      // in a sentence: an inline link whose parent block holds other text too (WCAG 2.5.8 "inline" exception)
      const host = el.parentElement;
      const inSentence = cs.display === "inline" && !!host && (host.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 20;
      const inlineText = cs.display === "inline" && (!!el.closest("p, li, dd, label, figcaption, small, td") || inSentence);
      if (inlineText) continue;
      // a control wrapped by a label that is itself big enough counts as the label's size
      const label = el.closest("label");
      // a "stretched link" (an absolutely placed ::after over its card) is tapped anywhere on the card
      const after = getComputedStyle(el, "::after");
      const stretched = after.content !== "none" && after.position === "absolute" && after.inset !== "auto" ? el.parentElement?.closest("article, li, div.relative, [class*='relative']") : null;
      const box = label && (el.tagName === "INPUT") ? label.getBoundingClientRect() : stretched ? stretched.getBoundingClientRect() : r;
      if (box.width < 44 - 0.5 || box.height < 44 - 0.5) {
        const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }
    return out;
  });
}

export async function horizontalScroll(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (sw <= vw + 1) return [];
    const wide = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 && getComputedStyle(e).position !== "fixed"; })
      .filter((e) => !e.closest("[data-scroll-x], .overflow-x-auto, .overflow-x-scroll"))
      .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${(e.className?.toString() || "").split(" ").slice(0, 3).join(".")} right=${Math.round(e.getBoundingClientRect().right)}`);
    return [`page is ${sw}px wide in a ${vw}px viewport`, ...wide];
  });
}

/** Sticky/fixed bars never cover content: the main heading starts below any top bar at scroll 0, and at the bottom of
 *  the page the last content element ends above any bottom bar. */
export async function coveredContent(page: Page): Promise<Problem[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    const bars = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => {
      const p = getComputedStyle(e).position; const r = e.getBoundingClientRect();
      return (p === "fixed" || p === "sticky") && r.width > window.innerWidth * 0.6 && r.height > 0 && r.height < window.innerHeight * 0.4;
    });
    const top = Math.max(0, ...bars.map((b) => b.getBoundingClientRect()).filter((r) => r.top <= 1).map((r) => r.bottom));
    const h1 = document.querySelector("main h1, h1");
    if (h1) { const r = h1.getBoundingClientRect(); if (r.top < top - 1) out.push(`h1 top ${Math.round(r.top)} under a top bar ending at ${Math.round(top)}`); }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 150));
    const bottomBars = bars.map((b) => b.getBoundingClientRect()).filter((r) => r.bottom >= window.innerHeight - 1 && r.top > window.innerHeight / 2);
    const barTop = Math.min(window.innerHeight, ...bottomBars.map((r) => r.top));
    const footer = document.querySelector("footer");
    const lastText = footer ? [...footer.querySelectorAll<HTMLElement>("p, a, span")].filter((e) => e.textContent?.trim()).pop() : null;
    if (lastText) { const r = lastText.getBoundingClientRect(); if (r.bottom > barTop + 1) out.push(`footer text ends at ${Math.round(r.bottom)}, under a bottom bar starting at ${Math.round(barTop)}`); }
    window.scrollTo(0, 0);
    return out;
  });
}

export async function checkPage(page: Page, url: string, info: TestInfo, opts: { settle?: (p: Page) => Promise<void>; status?: number } = {}) {
  await watchFlashes(page);
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (opts.status) expect(res?.status(), `${url} status`).toBe(opts.status);
  else expect(res?.status(), `${url} status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle").catch(() => {});
  await opts.settle?.(page);
  await page.waitForTimeout(300);
  const problems = {
    horizontalScroll: await horizontalScroll(page),
    smallTargets: await smallTargets(page),
    covered: await coveredContent(page),
    flashes: await page.evaluate(() => (window as unknown as { __flashes: string[] }).__flashes ?? []),
  };
  mkdirSync(SHOTS, { recursive: true });
  const vp = page.viewportSize()!;
  const name = `${url === "/" ? "home" : url.replace(/^\//, "").replace(/[/?=&]/g, "_")}${info.project.name.includes("paid") ? "-signedout" : ""}-${vp.width}x${vp.height}.png`;
  // full page when it fits the 32,767 px screenshot limit at the device's pixel ratio, else the first screen
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: h * dpr < 32000 });
  if (process.env.IPHONE_LOG) appendFileSync(process.env.IPHONE_LOG, JSON.stringify({ url, vp: `${vp.width}x${vp.height}`, project: info.project.name, ...problems }) + "\n");
  await info.attach(`${url} problems`, { body: JSON.stringify(problems, null, 2), contentType: "application/json" });
  expect(problems, `${url} at ${vp.width}×${vp.height}`).toEqual({ horizontalScroll: [], smallTargets: [], covered: [], flashes: [] });
}
