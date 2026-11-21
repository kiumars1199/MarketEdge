#!/usr/bin/env node
// T-295: INP for a timespan (web-vitals onINP injected before load), 390×844, CPU throttled 4× like Lighthouse mobile.
//   BASE=http://localhost:3211 node scripts/perf/inp.mjs /bets /
// On each path: clicks up to 3 filter chips (button[aria-pressed]) twice each, then opens the first card's
// "Why this bet?" (or any <summary>/aria-expanded button). Prints the INP and the slowest interaction's target.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const pnpmDir = path.resolve(here, "../../node_modules/.pnpm");
const wv = readdirSync(pnpmDir).filter((d) => d.startsWith("web-vitals@")).sort().at(-1);
const iife = readFileSync(path.join(pnpmDir, wv, "node_modules/web-vitals/dist/web-vitals.attribution.iife.js"), "utf8");
const base = process.env.BASE ?? "http://localhost:3211";
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ["/bets"];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const p of paths) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: false });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(`${iife}
    window.__inp = []; webVitals.onINP((m) => window.__inp.push({ v: m.value, t: m.attribution && m.attribution.interactionTarget }), { reportAllChanges: true });`);
  await page.goto(base + p, { waitUntil: "networkidle" });
  let clicks = 0;
  const chips = page.locator("button[aria-pressed]:visible");
  const n = Math.min(3, await chips.count());
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) {
    await chips.nth(i).click({ timeout: 5000 }).then(() => clicks++, () => {});
    await page.waitForTimeout(400);
  }
  const why = page.locator("main summary, main button[aria-expanded]").first();
  if (await why.count()) { await why.click({ timeout: 5000 }).then(() => clicks++, () => {}); await page.waitForTimeout(400); }
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(300);
  const inp = await page.evaluate(() => window.__inp.at(-1) ?? null);
  console.log(`${p.padEnd(15)} clicks=${clicks} INP=${inp ? Math.round(inp.v) + " ms" : "n/a"}${inp?.t ? `  (${inp.t})` : ""}`);
  await ctx.close();
}
await browser.close();
