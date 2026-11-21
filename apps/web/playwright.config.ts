import { defineConfig, devices } from "@playwright/test";

// Smoke flows S1–S6 live in e2e/. Runs against the fixture data on its own port (3100), so a real-data
// dev server on 3000 is never reused by mistake.
const PORT = Number(process.env.PW_PORT ?? 3100);   // lanes running in parallel each pick their own
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${PORT}` },
  // docs/OVERHAUL.md §D: the iPhone spec runs in WebKit at 390×844 and 430×932; everything else in Chromium.
  // PW_CHROMIUM_PATH: use a preinstalled Chromium when the pinned Playwright's own build isn't downloaded.
  projects: [
    { name: "chromium", testIgnore: /overhaul-iphone/, use: { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } },
    { name: "iphone-390", testMatch: /overhaul-iphone/, use: { ...devices["iPhone 15"], viewport: { width: 390, height: 844 } } },
    { name: "iphone-430", testMatch: /overhaul-iphone/, use: { ...devices["iPhone 15 Pro Max"], viewport: { width: 430, height: 932 } } },
  ],
  webServer: {
    // Production build, not `next dev`: on-demand route compiles made parallel runs time out at random.
    // PW_DEV=1 switches back to dev for quick local iteration.
    command: process.env.PW_DEV ? `pnpm exec next dev -p ${PORT}` : `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    timeout: 300_000,
    port: PORT,
    reuseExistingServer: false,
    // KALSHI_TRADING_ENV=demo: the paper Trade button shows (trading-paper flow); other flows don't open it.
    env: { DATA_DIR: "test/fixtures", DATA_SOURCE: "local", DATA_CLOCK: "scan", DEMO_MODE: "true", KALSHI_TRADING_ENV: "demo", KALSHI_DATA_PERMISSION: "true" },
  },
});
