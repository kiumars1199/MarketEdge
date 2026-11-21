// Run 4, item 11: load the store zip (unzipped) in a fresh Chromium profile; the service worker starts and the popup renders with the disclaimer.
const { chromium } = require("/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad/clean6/apps/web/node_modules/@playwright/test");
const DIR = process.argv[2];
(async () => {
  const ctx = await chromium.launchPersistentContext("", { channel: "chromium", args: [`--disable-extensions-except=${DIR}`, `--load-extension=${DIR}`] });
  let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  const id = new URL(sw.url()).host; console.log(`service worker: ${sw.url()}`);
  const errs = []; const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  for (const page of ["popup.html", "sidepanel.html"]) {
    await p.goto(`chrome-extension://${id}/${page}`); await p.waitForTimeout(1500);
    const t = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    console.log(`${page}: disclaimer=${t.includes("Market analytics, not financial advice. Based on past results. 18+.")} text="${t.slice(0, 200)}"`);
  }
  console.log(`page errors / console errors: ${errs.length} ${errs.slice(0, 3).join(" | ")}`);
  await ctx.close();
})();
