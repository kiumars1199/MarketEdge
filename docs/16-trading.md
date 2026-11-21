# 16 · Placing trades on Kalshi

Goal: let a user act on a Kismet bet without leaving the app. This doc separates what can be built
now (paper trading on Kalshi's demo exchange, behind a flag) from what needs outside sign-off before real
money flows.

## 1. How Kalshi trading works technically
- Users create API keys in their Kalshi account. Keys are an Ed25519 (recommended) or RSA-2048 pair; each
  request is signed with the private key and sent with three headers: `KALSHI-ACCESS-KEY` (key id),
  `KALSHI-ACCESS-TIMESTAMP` (ms, within 30 s of Kalshi's clock), `KALSHI-ACCESS-SIGNATURE` (base64 signature of
  `timestamp + METHOD + path` without the query string; RSA uses RSA-PSS SHA-256).
  (docs.kalshi.com/getting_started/api_keys)
- Keys have **scopes**. A key with only `write::trade` can place and cancel orders but not move money
  (`write::transfer` is separate). `read` is needed to see orders, fills and positions.
- Orders: `POST /trade-api/v2/portfolio/events/orders` (V2; the legacy `/portfolio/orders` is being deprecated),
  batch variant, amend, cancel; WebSocket for live fills. Kalshi runs a **demo exchange with fake money**
  (`https://external-api.demo.kalshi.co/trade-api/v2`) with the same API.

## 2. The rules that decide what we can ship
1. **CFTC introducing-broker rules.** Software that lets users send orders for event contracts can trigger
   introducing-broker (IB) registration. CFTC Staff Letter 26-25 (Sept 17, 2026) gives no-action relief to
   "passive software" providers, but only if they do **not** hold user assets, **generate express buy or sell
   signals**, or exercise discretion over routing — and only after filing a notice, giving users conflict and
   risk disclosures, following NFA marketing rules, keeping records, and signing a **joint-liability undertaking
   together with each registered partner (here: Kalshi)**.
   Kismet's core product ("Bet Yes at 68¢, +24% expected") is very likely a buy signal. Combining it with
   order submission probably falls outside the relief, which would mean IB registration (NFA membership,
   capital requirements, exams) or a structure a lawyer designs.
2. **Kalshi's Developer Agreement** limits API use to a member's own trading and bars commercial reuse of data
   without written permission. Kalshi has partner integrations (keys "issued through a partner integration"
   are counted separately), so the path is a **partnership/data agreement with Kalshi**, which the
   joint-liability undertaking needs anyway.
3. **Our own risk:** holding users' trading keys makes us a target; a breach would let an attacker place trades
   on users' accounts.

**Decision:** build the full trading experience now against Kalshi's **demo exchange** (fake money), behind a
feature flag, with keys that never touch our servers. Ship real-money trading only after §5. Until then, every
bet gets an **"Open on Kalshi / Polymarket"** link (no order placement by us).

## 3. Design
### Key custody: keys live only in the user's browser extension
- Connect flow (Premium, extension installed): user creates a Kalshi key with **`read` + `write::trade` only**,
  pastes key id + private key into the extension's side panel. The extension imports the private key with
  WebCrypto as **non-extractable**, stores it in IndexedDB, and verifies scopes with a signed `GET /portfolio/balance`.
  Keys with `write::transfer` (or full `write`) are rejected with instructions to make a trade-only key.
- Our servers never receive the key. Orders are signed and sent by the extension's background worker directly to
  Kalshi (extension host permission for `api.elections.kalshi.com` / `external-api.demo.kalshi.co`, so no CORS issue).
- The web app talks to the extension with `chrome.runtime.sendMessage(EXT_ID, intent)`; `externally_connectable`
  allows only our origin; each intent carries a one-time nonce from our server so other sites can't fire orders.
- No extension installed → the order ticket shows "Install the extension to trade from Kismet" + "Open on Kalshi".

### Market matching (Polymarket ↔ Kalshi)
- Engine job `kalshi_match` (only in the environment that has Kalshi permission; demo uses the demo exchange's
  public markets): pull open Kalshi events/markets, match to our markets by normalized title tokens, outcome names,
  category, and close time within ±3 h; store `kalshi_ticker` + confidence on each market. Show "Also on Kalshi at
  64¢" only when confidence ≥ 0.9; never auto-route.
- For Kalshi-only markets later: the model needs Kalshi history → requires the Kalshi data agreement.

### Order ticket (drawer → "Trade")
1. Side (Yes/No), **limit price** prefilled at the current ask (user can change), amount in $ or contracts.
2. Shows: Kalshi fee estimate, max cost (`buy_max_cost`), payout if it wins, Kismet return at that price, the
   execution check for that size (docs/07), and Kalshi's own risk disclosure link.
3. **Confirm screen every time** (no one-click), then the extension submits with a `client_order_id` (UUID) for safe retries.
4. Live status via `read` scope: resting / partially filled / filled / cancelled; cancel button; fills land in
   **My bets** automatically (with entry price, fee, Kismet numbers at entry).
5. Safety settings: max $ per order, max $ per day, require confirmation (always on), "paper mode" badge in demo.
   No auto-trading, no "trade all best bets", no copying, no AI-placed orders. Ever.

### Portfolio view
"My Kalshi" tab (inside My bets): balance, open positions, resting orders, P&L — read through the extension.
Display-only; Kismet never ranks or suggests bets from these positions (product rule).

## 4. Build now (flagged)
- `KALSHI_TRADING_ENV=demo` enables the Trade button for allow-listed users and points everything at
  `external-api.demo.kalshi.co`. Unset in production.
- Signing library shared by extension + tests: Ed25519 and RSA-PSS, verified against Kalshi's documented example.
- E2E against the demo exchange with a test account: connect key → place limit order → see it resting → cancel →
  place marketable order → fill shows in My bets.

## 5. Before real money (owner to-do, not code)
1. Email Kalshi (partnerships/developer relations): data license + partner integration for a third-party
   trading front end; ask whether they'll sign the 26-25 undertaking.
2. A CFTC/NFA lawyer reviews whether Kismet's analytics + order ticket needs IB registration, and how to
   structure it (e.g., separate entities/products, or registering).
3. If going ahead under 26-25: file the notice, add conflict + risk disclosures with recorded acknowledgment,
   adopt NFA-style marketing policies, set up recordkeeping.
4. Flip `KALSHI_TRADING_ENV=prod` only after 1–3.
Polymarket trading (Polymarket US is also a CFTC-regulated exchange) follows the same rules; same plan.
