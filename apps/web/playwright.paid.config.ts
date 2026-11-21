import { defineConfig, devices } from "@playwright/test";

// Paid-mode flows (S7 upgrade, account delete): DEMO_MODE=false, with Supabase and Stripe served by the in-app
// mock (app/e2e-mock, on only with E2E_MOCK=1 outside production). Same port as the demo run; they run one after the other.
const PORT = Number(process.env.PW_PORT ?? 3100);
const ORIGIN = `http://localhost:${PORT}`;
export default defineConfig({
  testDir: "e2e-paid",
  workers: 1,
  timeout: 120_000,   // a cold .next compiles every route on first hit
  use: { baseURL: ORIGIN },
  // docs/OVERHAUL.md §D: the iPhone spec runs in WebKit at 390×844 and 430×932; everything else in Chromium.
  // PW_CHROMIUM_PATH: use a preinstalled Chromium when the pinned Playwright's own build isn't downloaded.
  projects: [
    { name: "chromium", testIgnore: /overhaul-iphone/, use: { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } } },
    { name: "iphone-390", testMatch: /overhaul-iphone/, use: { ...devices["iPhone 15"], viewport: { width: 390, height: 844 } } },
    { name: "iphone-430", testMatch: /overhaul-iphone/, use: { ...devices["iPhone 15 Pro Max"], viewport: { width: 430, height: 932 } } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: {
      DATA_DIR: "test/fixtures", DATA_SOURCE: "local", DATA_CLOCK: "scan", DEMO_MODE: "false", NEXT_PUBLIC_DEMO_MODE: "false", E2E_MOCK: "1",
      NEXT_PUBLIC_SITE_URL: ORIGIN, ADMIN_EMAILS: "admin-e2e@example.com",   // e2e admin (e2e-paid/admin.spec.ts), never the owners
      KALSHI_DATA_PERMISSION: "true",   // as production (owner decision, Nov 21): /kalshi and the Kalshi combo check are on
      NEXT_PUBLIC_SUPABASE_URL: `${ORIGIN}/e2e-mock/supabase`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon", SUPABASE_SERVICE_ROLE_KEY: "e2e-service",
      STRIPE_SECRET_KEY: "sk_test_e2e", STRIPE_WEBHOOK_SECRET: "whsec_e2e", STRIPE_API_BASE: ORIGIN,
      STRIPE_PRICE_PRO_MONTHLY: "price_pro_m", STRIPE_PRICE_PRO_YEARLY: "price_pro_y",
      STRIPE_PRICE_PREMIUM_MONTHLY: "price_premium_m", STRIPE_PRICE_PREMIUM_YEARLY: "price_premium_y",
    },
  },
});
