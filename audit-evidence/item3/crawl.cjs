// usage: node crawl.cjs <base> <state> <storageState|-> <out.json> [shotsDir]
const { chromium } = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@playwright/test");
const fs = require("fs");
const [base, state, ss, out, shots] = process.argv.slice(2);
const DISC = "Market analytics, not financial advice. Based on past results. 18+.";
const BAD = /\bNaN\b|\bundefined\b|\[object Object\]|(?<![\w-])null(?![\w-])|lorem ipsum|TODO|FIXME/i;
const BANNED = /\b(guarantee[ds]?|risk[- ]free|sure[- ]thing|can.?t lose|cannot lose|lock of the|un?lock(s|ed|ing)?\b|free money|easy money|tips?\b|pick(s|ed|ing)?\b)/gi;
const ROUTES = (process.env.ROUTES || "/ /about /account /admin /admin/audit /admin/grants /admin/health /admin/settings /admin/users /alerts /bets /combos /contact /dashboards /disclaimer /ext/connect /journal /kalshi /login /maintenance /markets /onboarding /pricing /privacy /refunds /reset-password /settings /signup /status /terms /tools /track-record /watchlist /oauth/consent /no-such-page /a/b/c").split(" ");
(async () => {
  const browser = await chromium.launch();
  const results = [];
  const linkSet = new Map();
  // dynamic ids
  const api = await (await browser.newContext({ storageState: ss !== "-" ? ss : undefined, baseURL: base })).request;
  let extra = [];
  try {
    const r = await (await api.get(base + "/api/markets?ps=5")).json();
    const row = (r.rows || [])[0];
    const m = row && (row.market || row); if (m) { extra.push("/m/" + encodeURIComponent(m.id)); if (m.event_id) extra.push("/event/" + encodeURIComponent(m.event_id)); }
  } catch (e) {}
  if (process.env.EXTRA) extra.push(...process.env.EXTRA.split(" "));
  const routes = [...ROUTES, ...extra];
  for (const width of (process.env.WIDTHS || "390 1440").split(" ").map(Number)) {
    const ctx = await browser.newContext({ storageState: ss !== "-" ? ss : undefined, viewport: { width, height: width < 600 ? 844 : 900 }, baseURL: base, timezoneId: process.env.TZID || undefined });
    for (const route of routes) {
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 1.25e6, uploadThroughput: 0.5e6 });
      const rec = { state, width, route, console: [], pageerrors: [], failed: [], bad: [], banned: [], disclaimer: null, status: null, finalUrl: null, hydrationMismatch: [] };
      page.on("console", (m) => { if (["error", "warning"].includes(m.type())) rec.console.push(`${m.type()}: ${m.text()}`.slice(0, 4000)); });
      page.on("pageerror", (e) => rec.pageerrors.push(String(e.stack || e).slice(0, 2000)));
      page.on("response", (r) => { const u = r.url(); if (u.startsWith(base) && r.status() >= 400 && !u.endsWith(route)) rec.failed.push(`${r.status()} ${u.slice(base.length)}`); });
      page.on("requestfailed", (r) => { const u = r.url(); if (!/_rsc=|\/_next\/webpack-hmr/.test(u)) rec.failed.push(`FAILED ${u.slice(0,200)} ${r.failure()?.errorText}`); });
      try {
        const resp = await page.goto(base + route, { waitUntil: "load", timeout: 90000 });
        rec.status = resp?.status();
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
        rec.finalUrl = page.url().slice(base.length);
        const text = await page.evaluate(() => document.body.innerText);
        for (const line of text.split("\n")) { if (BAD.test(line)) rec.bad.push(line.slice(0, 200)); const m = line.match(BANNED); if (m) rec.banned.push(`${m.join(",")} :: ${line.slice(0, 160)}`); }
        const meta = await page.evaluate(() => [...document.querySelectorAll("meta[content]")].map((m) => `${m.getAttribute("name")||m.getAttribute("property")}=${m.content}`).join("\n"));
        for (const line of meta.split("\n")) { const m = line.match(BANNED); if (m) rec.banned.push(`META ${m.join(",")} :: ${line.slice(0, 160)}`); if (/guarantee|expected profit/i.test(line)) rec.banned.push("META " + line); }
        rec.disclaimer = text.includes(DISC);
        const footerHasDisc = await page.evaluate((d) => !!([...document.querySelectorAll("footer")].find((f) => f.innerText.includes(d))), DISC);
        rec.footerDisclaimer = footerHasDisc;
        const hs = (await page.evaluate(() => document.documentElement.scrollWidth)) ;
        rec.hscroll = hs > width + 1 ? hs : 0;
        const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
        for (const l of links) { if (!l || !l.startsWith("/") || l.startsWith("//")) continue; const k = l.split("#")[0]; if (!linkSet.has(k)) linkSet.set(k, `${route}@${width}`); }
        if (shots && (process.env.SHOTALL || rec.bad.length || rec.pageerrors.length || rec.hscroll)) await page.screenshot({ path: `${shots}/${state}-${width}-${route.replace(/\W+/g, "_") || "root"}.jpg`, type: "jpeg", quality: 45, fullPage: false });
      } catch (e) { rec.pageerrors.push("NAV: " + String(e).slice(0, 300)); }
      results.push(rec);
      await page.close();
    }
    await ctx.close();
  }
  // broken-link check
  const ctx = await browser.newContext({ storageState: ss !== "-" ? ss : undefined, baseURL: base });
  const links = [];
  for (const [l, from] of linkSet) {
    let st; try { st = (await ctx.request.get(base + l, { maxRedirects: 5, timeout: 60000 })).status(); } catch (e) { st = "ERR " + e; }
    links.push({ link: l, from, status: st });
  }
  fs.writeFileSync(out, JSON.stringify({ base, state, results, links }, null, 1));
  await browser.close();
  console.log("done", state, results.length, "pages", links.length, "links");
})();
