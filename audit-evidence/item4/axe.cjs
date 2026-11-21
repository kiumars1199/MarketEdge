// node axe.cjs <base> <state> <storage|-> <out.json>
const { chromium } = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@playwright/test");
const AxeBuilder = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@axe-core/playwright").default;
const fs = require("fs");
const [base, state, ss, out] = process.argv.slice(2);
const ROUTES = (process.env.ROUTES || "/ /about /pricing /track-record /status /terms /privacy /refunds /disclaimer /contact /login /signup /reset-password /markets /bets /watchlist /journal /alerts /dashboards /settings /tools /account /onboarding /combos /oauth/consent /m/6654466 /no-such-page").split(" ");
(async () => {
  const b = await chromium.launch(); const res = [];
  for (const w of [390, 1440]) {
    const ctx = await b.newContext({ storageState: ss !== "-" ? ss : undefined, viewport: { width: w, height: 900 } });
    for (const r of ROUTES) {
      const p = await ctx.newPage();
      try { await p.goto(base + r, { waitUntil: "load", timeout: 90000 }); await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(800);
        const a = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
        const v = a.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, sample: x.nodes[0]?.target?.join(" ") }));
        res.push({ w, r, final: p.url().slice(base.length), v });
      } catch (e) { res.push({ w, r, err: String(e).slice(0, 200) }); }
      await p.close();
    }
    await ctx.close();
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  const ser = res.flatMap((x) => (x.v || []).filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${x.w} ${x.r} ${v.id} ${v.impact} n=${v.n} ${v.sample}`));
  const minor = res.flatMap((x) => (x.v || []).filter((v) => !["serious", "critical"].includes(v.impact)).map((v) => `${x.w} ${x.r} ${v.id} ${v.impact}`));
  console.log(state, "pages", res.length, "errors", res.filter((x) => x.err).length, "serious/critical", ser.length); ser.forEach((s) => console.log("  SER", s));
  console.log("  minor/moderate:", [...new Set(minor.map((m) => m.split(" ").slice(2).join(" ")))].join("; "));
  await b.close();
})();
