// time from tab click until the new page shows anything (skeleton or content) and until its content is in
const { chromium } = require('playwright');
const BASE = process.argv[2]; const runs = +process.argv[3] || 5;
const routes = [['/bets','','/markets'],['/markets','','/watchlist'],['/watchlist','','/bets'],['/markets','','/bets']];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const out = {};
  for (const [from, label, to] of routes) {
    const fb = [], full = [];
    for (let i = 0; i < runs; i++) {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
      await p.goto(BASE + from, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);  // prefetch settles
      await p.evaluate(() => { window.__t0 = 0; const mark = () => { if (!window.__t0) return; const sk = document.querySelector('[data-skeleton]'); if (sk && !window.__fb) window.__fb = performance.now() - window.__t0; };
        new MutationObserver(mark).observe(document.body, { subtree: true, childList: true }); });
      const link = p.locator(`a[href="${to}"]:visible`).first();
      await p.evaluate(() => { window.__t0 = performance.now(); });
      await link.click();
      await p.waitForURL('**' + to);
      await p.waitForFunction(() => !document.querySelector('[data-skeleton]') && document.querySelector('main h1'), null, { timeout: 30000 });
      const r = await p.evaluate(() => ({ fb: window.__fb ?? null, full: performance.now() - window.__t0 }));
      // first feedback = skeleton if one showed, else the content itself
      fb.push(Math.round(r.fb ?? r.full)); full.push(Math.round(r.full)); await ctx.close();
    }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    out[`${from} → ${to}`] = { first_feedback_ms: med(fb), content_ms: med(full), fb, full };
  }
  console.log(JSON.stringify(out, null, 1)); await b.close();
})();
