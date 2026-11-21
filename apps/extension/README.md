# Kismet for Polymarket (Chrome MV3 extension)

Shows Kismet analytics next to Polymarket outcomes. It reads only the page URL slug; every number
comes from the Kismet API (`GET /api/events/by-slug/<slug>`). Demo mode talks to `http://localhost:3000`
with no sign-in, tier Premium.

## Build and load unpacked

1. Start the web app (serves real data from `../../output`):
   `cd apps/web && pnpm i && pnpm dev`
2. Install the extension's dependencies:
   `cd apps/extension && pnpm i`
3. Build it into `apps/extension/dist`:
   `pnpm build`
4. Open the extensions page in Chrome:
   `open -a "Google Chrome" chrome://extensions` (or type `chrome://extensions` in the address bar)
5. Turn on **Developer mode** (top right), click **Load unpacked**, pick `apps/extension/dist`.
6. Open a Polymarket event, for example
   `open -a "Google Chrome" https://polymarket.com/event/highest-temperature-in-chicago-on-november-17-2026`

After a rebuild, click the reload icon on the extension's card in `chrome://extensions`.

## Checks

- `pnpm typecheck`
- `pnpm test` (vitest: matcher, Kalshi signing, order/caps/scope logic, no-auto-trade guard)
- `pnpm ext:zip`: store build (dev `key` stripped) zipped to `kismet-extension-<version>.zip`
- End to end: `cd apps/web && PW_PORT=3150 pnpm e2e trading-paper` builds this extension for that origin and drives it.

Build for another web origin with `KISMET_ORIGIN=https://<domain> pnpm build`. Owner setup (demo key, extension ID,
store submission): `docs/setup-notes/trading-extension.md`.

## How it works

- `src/background.ts` service worker: API calls with a 60 s cache per slug (`chrome.storage.session`), opens the side panel.
- `src/content.ts` reads the slug (last path segment; sports events redirect to `/sports/<league>/<slug>`),
  matches market labels to page text (`src/match.ts`), mounts one badge per matched market in a shadow root.
  When nothing matches on a page that has markets, it shows a floating pill that opens the side panel list.
- `sidepanel.html` / `src/sidepanel.ts`: one market (both sides, bars, price check, "Details for pros") or the page's list.
- `sidepanel.html` "Paper trading" tab (`src/vault-ui.ts`): connect a trade-only Kalshi demo key, limits.
- `popup.html` / `src/popup.ts`: sign-in state, plan, data status, paper-trading state, "Open Kismet", disclaimer.
- `src/kalshi/`: request signing (`sign.ts`), key vault in IndexedDB (`vault.ts`), demo-exchange client
  (`client.ts`), order/caps/scope logic (`trade.ts`). Orders are placed only from the web app's confirm screen,
  each with a one-time server nonce the background checks before signing.
