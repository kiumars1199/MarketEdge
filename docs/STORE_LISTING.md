# Chrome Web Store listing: Kismet for Polymarket

## Item details

- **Name:** Kismet for Polymarket
- **Summary (≤132 chars):** See how often bets like this one won before, next to every Polymarket price. Paper trading on Kalshi's demo exchange.
- **Category:** Productivity
- **Language:** English (United States)

### Description

Kismet shows prediction-market traders which contracts are priced below how often similar bets have won,
after fees and after the cost of crossing the spread.

On Polymarket event pages, a small badge sits next to each outcome Kismet covers:
"Pays 1.5x · won 72% before · market says 64% · +12% expected". Click it for the side panel with
both sides, the price check and the details behind each number: sample size, model level and backtest record.

Paper trading (optional): connect a trade-only key from Kalshi's demo exchange and place practice orders from
Kismet with fake money. Every order needs your confirmation. The key stays in your browser, can't be
exported, and Kismet's servers never see it.

- Badges on Polymarket event pages (Kismet Premium)
- Side panel with the full market view
- Paper trading on Kalshi's demo exchange, with per-order and per-day limits
- Sign-in from your Kismet account

Market analytics, not financial advice. Based on past results. 18+.

### Screenshots (1280x800, `docs/screenshots/store/`)

1. `1-paper-ticket.png`: paper order ticket on Kismet
2. `2-my-bets.png`: fills land in My bets
3. `3-key-vault.png`: side panel, trade-only key and limits
4. `4-popup.png`: popup with sign-in state and status

## Privacy practices tab

**Single purpose:** Show Kismet's market analytics next to Polymarket prices, and let the user place
paper (demo-exchange) orders they confirm on Kismet.

**Permission justifications**

| Permission | Why |
|---|---|
| `storage` | Keeps the short-lived Kismet sign-in token (session storage), the user's spending limits and the side panel selection. |
| `sidePanel` | Shows the market detail and the paper-trading settings in Chrome's side panel. |
| Host `https://<your domain>/*` | Reads Kismet analytics for the current Polymarket event, checks the one-time order code. |
| Host `https://external-api.demo.kalshi.co/*` | Sends the user's confirmed paper orders to Kalshi's demo exchange, signed with the user's key. |
| Content script on `polymarket.com/event/*`, `/sports/*` | Reads the event slug from the URL and places badges next to outcomes. It reads no other page content. |

**Remote code:** No. All code ships in the package.

**Data usage** (tick these in the form):

| Data type | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | |
| Health, financial and payment information | No | The Kalshi demo key stays in the browser; demo balances are fake money and are not sent to Kismet. |
| Authentication information | Yes | A Kismet sign-in token (30 min), held in session storage and sent only to Kismet. |
| Personal communications, location, web history | No | |
| User activity | No | |
| Website content | Yes | The Polymarket event slug of the page you're on, sent to Kismet to look up its analytics, plus a count of unmatched markets for quality checks. |

**Certifications (all three apply):**
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://<your domain>/privacy`

**Support:** `[[SUPPORT_EMAIL]]`
