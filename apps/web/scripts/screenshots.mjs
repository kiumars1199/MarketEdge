// Full-page screenshots of every page at 390 and 1440 px (docs/17, Lane U).
// Usage: start the app (DEMO_MODE=true DATA_SOURCE=local), then
//   BASE=http://localhost:3080 OUT=../../docs/screenshots/final node scripts/screenshots.mjs [only-name ...]
// Also prints console errors/warnings and any NaN/undefined/null/[object Object] seen on a page.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3080";
const OUT = process.env.OUT ?? "../../docs/screenshots/final";
const PREFIX = process.env.PREFIX ?? "";
mkdirSync(OUT, { recursive: true });

const first = await (await fetch(`${BASE}/api/flags?page_size=1`)).json();
const m = first.rows[0].market;
const PAGES = [
  ["home", "/"], ["markets", "/markets"], ["drawer", `/?m=${m.id}&side=${first.rows[0].side.side_index}`],
  ["event", `/event/${m.event_id}`], ["market", `/m/${m.id}`], ["about", "/about"], ["pricing", "/pricing"],
  ["login", "/login"], ["onboarding", "/onboarding"], ["account", "/account"], ["watchlist", "/watchlist"],
  ["journal", "/journal"], ["alerts", "/alerts"], ["dashboards", "/dashboards"], ["settings", "/settings"],
  ["tools", "/tools"], ["track-record", "/track-record"], ["status", "/status"], ["terms", "/terms"],
  ["privacy", "/privacy"], ["refunds", "/refunds"], ["disclaimer", "/disclaimer"], ["contact", "/contact"],
  ["404", "/no-such-page"], ["ext-connect", "/ext/connect"],
];
const only = process.argv.slice(2);
const browser = await chromium.launch();
for (const [name, path] of PAGES.filter(([n]) => !only.length || only.includes(n))) {
  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const logs = [];
    page.on("console", (msg) => ["error", "warning"].includes(msg.type()) && logs.push(`${msg.type()}: ${msg.text().slice(0, 200)}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(800);
    const text = await page.locator("body").innerText();
    const bad = text.match(/\bNaN\b|\bundefined\b|\[object Object\]|(?<![\w-])null(?![\w-])/g);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${OUT}/${PREFIX}${name}-${width}.png`, fullPage: name !== "drawer" });   // the drawer scrolls inside a fixed panel
    console.log(`${name}-${width}${scroll > 0 ? ` HSCROLL+${scroll}` : ""}${bad ? ` BAD:${[...new Set(bad)]}` : ""}${logs.length ? `\n  ${logs.join("\n  ")}` : ""}`);
    await ctx.close();
  }
}
await browser.close();
