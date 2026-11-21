const { chromium } = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@playwright/test");
const fs = require("fs");
const [base, st, route, width, n, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const log = [];
  for (let i = 0; i < Number(n); i++) {
    const ctx = await b.newContext({ storageState: st === "-" ? undefined : `/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/r4/states/${st}.json`, timezoneId: process.env.TZID || undefined, viewport: { width: Number(width), height: Number(width) < 600 ? 844 : 900 } });
    const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable"); if (!process.env.NOTHROTTLE) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 1.25e6, uploadThroughput: 0.5e6 });
    const msgs = [];
    p.on("console", (m) => { if (["error", "warning"].includes(m.type())) msgs.push(`[console.${m.type()}] ${m.text()}`); });
    p.on("pageerror", (e) => msgs.push(`[pageerror] ${e.message}\n${e.stack ?? ""}`));
    await p.goto(base + route, { waitUntil: "load" }); await p.waitForTimeout(4000);
    const hyd = msgs.filter((m) => /hydrat|Minified React error|#41[89]|#42[3-5]/i.test(m));
    log.push(`=== run ${i + 1} ${base}${route} @${width} state=${st}: ${hyd.length} hydration messages`);
    log.push(...hyd); log.push("-- all errors/warnings:", ...msgs.map((m) => m.slice(0, 600)));
    await ctx.close();
  }
  fs.writeFileSync(out, log.join("\n")); console.log(log.filter((l) => l.startsWith("===")).join("\n"));
  await b.close();
})();
