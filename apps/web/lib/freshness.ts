// Data freshness (F-24): fresh until 3 h, amber until 6 h, red ("data may be stale") after.
// One threshold for every stale notice (pill, banner, status): the banner shows when this is not "fresh".
export type Freshness = "fresh" | "amber" | "red";

/** How often prices refresh, in words, for copy. QA-A #2: what the engine really does. Railway's deploy logs (Nov 21)
 *  show a scan every 900 s (SCAN_EVERY_SEC), pushed to about 22 min once an hour by the update, fit and grade; the GitHub
 *  fallback (.github/workflows/refresh.yml) runs only when that host is down. */
export const REFRESH_WORDS = "about every 15 minutes";
/** The longest normal gap between scans (the hourly fit pushes one to ~22 min), with room for one missed scan. */
export const SCAN_LATE_MIN = 45;

/** QA-A #2: this scan is older than the cadence explains, for a viewer who sees scans `delayMin` late (Free). The
 *  colours (freshness) stay on their 3 h / 6 h rule; this only stops /status calling late data "current". */
export const scanLate = (scannedAt: number | null | undefined, delayMin = 0, now = Date.now()) =>
  typeof scannedAt !== "number" || (now - scannedAt * 1000) / 60_000 > SCAN_LATE_MIN + delayMin;

export function freshness(scannedAt: number | null | undefined, now = Date.now()): Freshness {
  if (typeof scannedAt !== "number" || !Number.isFinite(scannedAt)) return "red";
  const h = (now - scannedAt * 1000) / 3_600_000;
  return h > 6 ? "red" : h > 3 ? "amber" : "fresh";
}

/** Minutes until the next GitHub Actions full run (.github/workflows/refresh.yml: "17 *\/2 * * *" UTC). Scans run
 *  more often than that (see REFRESH_WORDS), so the UI no longer quotes this as "next scan". */
export function nextScanMin(now = Date.now()): number {
  const d = new Date(now);
  const sinceSlot = ((d.getUTCHours() % 2) * 60 + d.getUTCMinutes() - 17 + 120) % 120;   // minutes past the last :17 slot
  return Math.max(1, 120 - sinceSlot - (d.getUTCSeconds() > 0 ? 1 : 0));
}
/** "6 min", "1 h 20 min" */
export const nextScanIn = (now = Date.now()) => {
  const m = nextScanMin(now);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
