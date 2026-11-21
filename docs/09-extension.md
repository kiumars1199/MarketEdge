# 09 · Chrome extension (Premium)

## What it does
On a Polymarket market or event page, it shows a small Kismet badge next to each outcome:
"Win chance 79% · Edge +5.1¢ · Worth it". Clicking opens a side panel with the drawer content
(both sides, verdict, stake table, curve, "Open in Kismet"). Kalshi pages: later, only after
Kalshi grants permission (their site terms ban scripts on kalshi.com without it).

## Why it reads the page lightly
It does **not** scrape prices from the page DOM. It reads only the page URL slug, asks the Kismet
API for that event's markets, and anchors badges next to outcome labels it can match by text. All
numbers come from Kismet's API (which uses Polymarket's public API).

## Structure (Manifest V3)
```
apps/extension/
  manifest.json      matches: https://polymarket.com/event/*; permissions: storage, sidePanel
  background.ts      service worker: auth token storage, API calls, 60 s cache per event
  content.ts         reads location.pathname → slug; MutationObserver for SPA navigation;
                     finds outcome rows; injects <me-badge> (shadow DOM, no style leaks)
  sidepanel.html/ts  drawer view (shared React components built from apps/web/ui)
  popup.html/ts      sign-in state, tier, "Open Kismet", disclaimer
```
```ts
// content.ts
onUrlChange(async () => {
  const slug = location.pathname.split("/event/")[1]?.split(/[/?#]/)[0]; if (!slug) return
  const data = await chrome.runtime.sendMessage({ type: "event", slug })   // background → /api/events/by-slug/:slug
  if (!data?.markets) return
  for (const row of findOutcomeRows(document)) {             // text match of outcome label + question
    const m = matchMarket(row.text, data.markets); if (!m) continue
    mountBadge(row.el, m.best, m.execution?.verdict)
  }
})
```
Signals that markup changed (no rows found on a page that has markets) are reported to `/api/ext/telemetry`
so selectors can be fixed fast. Fallback: a floating "Kismet: 3 flagged markets on this page" pill.

## Auth
"Sign in" opens the web app's `/ext/connect` page, which posts a short-lived token to the extension via
`chrome.runtime.sendMessage(EXT_ID, {token})` (externally_connectable). Background refreshes it. Non-Premium:
badge shows a lock with "Premium" and links to pricing.

## Constraints learned on FastPaste (still true)
Use `chrome.storage` for state, not page globals. Service workers have no `window.confirm/prompt`.
Arc may override shortcuts; give every action a click target. Keep the badge in a shadow root.

## Store listing
Name "Kismet for Polymarket", category Productivity, single purpose: "Shows Kismet analytics next
to Polymarket outcomes." Disclose: no data sold, reads only the current URL on polymarket.com.
