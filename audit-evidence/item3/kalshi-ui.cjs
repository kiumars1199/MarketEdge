// Run 4, 3-c: beta tester with no kalshi.json reaches /kalshi from the nav (header @1440, "More" menu @390) and sees an empty state; others have no link and get 404.
const { chromium } = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@playwright/test");
const R = "/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/r4";
const W = "http://localhost:3161";
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const st of ["beta", "free", "premium"]) for (const w of (process.env.WS ?? "1440,390").split(",").map(Number)) {
    const ctx = await b.newContext({ storageState: `${R}/states/${st}.json`, viewport: { width: w, height: w < 600 ? 844 : 900 } });
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await p.goto(W + "/", { waitUntil: "load" }); await p.waitForTimeout(2500);
    if (w < 600) { const more = p.locator("nav[aria-label=Main] button", { hasText: "More" }).last(); if (await more.count()) { await more.click(); await p.waitForTimeout(500); } }
    const link = p.locator('a[href="/kalshi"]:visible').first(); const has = await link.count();
    let res = `${st} @${w}: visible /kalshi link=${has}`;
    if (has) { await link.click(); await p.waitForURL("**/kalshi"); await p.waitForTimeout(2000);
      const h1 = await p.locator("h1").first().textContent(); const empty = await p.getByText("No Kalshi data yet").count();
      res += ` -> url=${new URL(p.url()).pathname} h1="${h1?.trim()}" emptyState=${empty}`; await p.screenshot({ path: `${R}/shots/3c-${st}-${w}.png` });
    } else { const r = await p.goto(W + "/kalshi", { waitUntil: "load" }); res += ` -> direct /kalshi status=${r.status()} title="${await p.title()}"`; }
    out.push(res + ` consoleErrors=${errs.filter((e) => !/404|Failed to load resource/.test(e)).length}`); await ctx.close();
  }
  console.log(out.join("\n")); await b.close();
})();
