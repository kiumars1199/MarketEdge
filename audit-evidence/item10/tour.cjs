const { chromium } = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@playwright/test");
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ storageState: process.argv[2], viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  await p.goto("http://localhost:3161/?tour=1", { waitUntil: "load" }); await p.waitForTimeout(4000);
  for (let i = 0; i < 6; i++) { const d = p.getByRole("dialog"); if (!(await d.count())) break; const t = (await d.first().innerText()).replace(/\s+/g, " "); console.log(`step ${i + 1}: ${t}`);
    if (/past flagged bets/.test(t)) await p.screenshot({ path: "shots/tour-results-step.png" });
    const n = d.getByRole("button", { name: /Next|Done|Finish/ }); if (!(await n.count())) break; await n.first().click(); await p.waitForTimeout(600); }
  await b.close(); })();
