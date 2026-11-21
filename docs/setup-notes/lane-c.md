# Lane C setup notes: tiers, payouts, combos

Nothing here is needed for DEMO_MODE. Everything works with no keys except the Kalshi combo price check, which
stays hidden.

## Kalshi combo price check (`KALSHI_DATA_PERMISSION`)

The combo tray can ask Kalshi for the price of the same combo as a real Kalshi combo contract
(`POST /api/combos/kalshi`, see `apps/web/lib/kalshiCombo.ts`). It is off by default.

1. Get written confirmation from Kalshi that Kismet may read and show their market data (including combo
   lookups) to subscribers. Their public API terms cover personal use, not redistribution.
2. Set `KALSHI_DATA_PERMISSION=true` in Vercel (Production and Preview).
3. The check uses `api.elections.kalshi.com`, or Kalshi's demo API when `KALSHI_TRADING_ENV=demo`. It sends no
   key. This was built against Kalshi's docs and mocked in tests, never run against the live API. Check it once
   on the demo API first: if Kalshi wants a signed request for the combo lookup, the tray shows "Couldn't check
   Kalshi right now" and the lookup needs the signing code from `lib/trade`.

The button also needs every leg to have a `kalshi_ticker`. The engine does not set that field yet, so today the
button never appears, even with the flag on. When the engine starts matching Polymarket markets to Kalshi tickers
in `markets.json`, the check lights up with no web change.

## Paper combo orders

With `KALSHI_TRADING_ENV=demo` and the trading extension connected, "Trade combo (paper)" opens the existing order
ticket (`openTicket`). It never sends a live order.

## Suggested combos

`GET /api/combos` builds the "Combos" row from Best bets on different events closing within 24 h. A leg count is
hidden whenever `backtest.json` says those combos lost money in testing (`backtest.combos["2"|"3"].roi_pct <= 0`)
or has no record for them. No setup needed.
