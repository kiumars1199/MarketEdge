# Owner notes: Kalshi paper trading and the Chrome extension (Lane E+K)

Trading is **off** until you set `KALSHI_TRADING_ENV=demo`. Only Kalshi's demo exchange
(`https://external-api.demo.kalshi.co/trade-api/v2`, fake money) is reachable. Production Kalshi is not in the code
and not in the extension's host permissions.

## 1. Kalshi demo account

1. Sign up at https://demo.kalshi.co (separate from a real Kalshi account; no money, no KYC).
2. The demo account starts with a fake balance. Use it for testing.

## 2. Trade-only demo API key

1. On demo.kalshi.co: Account → Profile → API keys → Create key.
2. Give it only the scopes **read** and **write::trade**. The extension refuses any key with `write`,
   `write::transfer` or any other `write::*` scope.
3. Kalshi shows the key ID and downloads the private key (`.pem`) once. Keep the file outside the repo.
4. Users paste the key ID and the PEM into the extension's side panel → **Paper trading**. The key is imported as
   a non-extractable WebCrypto key in IndexedDB. It never reaches Kismet servers, logs or analytics.

Optional, for the e2e against the real demo exchange: put these in `apps/web/.env.local` (git-ignored):

```
KALSHI_DEMO_KEY_ID=<key id>
KALSHI_DEMO_PRIVATE_KEY_PATH=<path to .pem, relative to apps/web>
KALSHI_DEMO_TICKER=<an open demo market ticker>
```

Without them, `trading-paper` mocks Kalshi at the network layer and checks every request signature.

## 3. Server env vars (`.env.example`, block "Lane E+K")

| Var | What |
|---|---|
| `KALSHI_TRADING_ENV` | `demo` turns trading on. Unset = off: no Trade button, nonce routes return 404. |
| `TRADING_ALLOWLIST` | Comma-separated emails allowed to trade (ignored in `DEMO_MODE`, where everyone may). |
| `EXT_SIGNING_SECRET` | 32+ random chars. Signs order nonces and extension sign-in tokens. Required outside demo mode. |
| `NEXT_PUBLIC_EXTENSION_ID` | The Chrome Web Store ID once published. Default: the pinned dev ID below. |
| `NEXT_PUBLIC_EXTENSION_STORE_URL` | Store listing URL, shown on `/ext/connect` when the extension is missing. |

Generate the secret with `openssl rand -base64 48`.

## 4. Extension ID, origin and `externally_connectable`

- The web app talks to the extension with `chrome.runtime.sendMessage(EXTENSION_ID, …)`. The extension only accepts
  messages whose origin equals `KISMET_ORIGIN` (`externally_connectable` + a `sender.origin` check).
- Build for your domain: `cd apps/extension && KISMET_ORIGIN=https://<your domain> pnpm build`. Default is
  `http://localhost:3000`.
- Dev builds carry a `key` in the manifest, so the unpacked ID is always `cgoaaiaghbckpalppklocajbdpoelmbd`.
- The store assigns its own ID. After the first upload, set `NEXT_PUBLIC_EXTENSION_ID` to it and redeploy the web app.

## 5. Chrome Web Store submission

1. `cd apps/extension && KISMET_ORIGIN=https://<your domain> pnpm ext:zip` → `kismet-extension-<version>.zip`
   (store build: the dev `key` is stripped).
2. Developer dashboard (https://chrome.google.com/webstore/devconsole, one-time $5 fee) → New item → upload the zip.
3. Listing text, screenshots (`docs/screenshots/store/`, 1280x800) and privacy answers: `docs/STORE_LISTING.md`.
4. Icons are in the zip (16/32/48/128). The store also wants a 128x128 icon upload: use `apps/extension/public/icons/128.png`.
5. Privacy policy URL: `https://<your domain>/privacy`. Support email: `[[SUPPORT_EMAIL]]` (config/site.json).
6. Two more screenshots of badges on a live Polymarket page are worth adding. Capture them in Chrome at 1280x800.
