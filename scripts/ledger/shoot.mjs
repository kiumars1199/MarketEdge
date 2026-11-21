// Screenshots of /track-record at 390x844 and 1440x900 (lane E evidence).
// node scripts/ledger/shoot.mjs <prefix>   (run from apps/web so @playwright/test resolves; server on PW_PORT, default 3221)
import { chromium } from "@playwright/test";

const prefix = process.argv[2] ?? "after";
const out = process.argv[3] ?? "../../docs/overhaul-evidence/E";
const port = process.env.PW_PORT ?? "3221";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: "dark" });
  await page.goto(`http://localhost:${port}/track-record`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${prefix}-track-record-${w}x${h}.png` });
  await page.screenshot({ path: `${out}/${prefix}-track-record-${w}x${h}-full.png`, fullPage: true });
  await page.close();
}
await browser.close();
