# 07 · Execution check: is the edge real at the price you'd pay?

## The problem (Q's point)
The model learns from historical **mid** prices. A market order pays the **ask**, then walks deeper
into the order book as size grows, then pays a fee. If the ask sits as far above the mid as the
model's edge, the edge is gone and Kismet adds nothing. So every flag must answer:
"after crossing the spread, at my stake size, is there still edge?"

## Definitions (per side, per market)
| Term | Formula | Meaning |
|---|---|---|
| mid | (best bid + best ask) / 2 | where the model reads the market |
| gross edge | q − mid | edge if you could trade at mid |
| spread cost | ask − mid | price of crossing the spread now |
| fee | rate × p × (1 − p) | Polymarket taker fee per share, rate by category |
| net edge | q − ask − fee(ask) | edge on the first share bought at market |
| retention | net / gross | how much of the edge survives crossing the spread |
| stake edge | q − avg fill − avg fee | edge for a $X market buy that walks the book |
| capacity | Σ size×(price+fee) over levels while q − price − fee ≥ min edge | $ before edge falls below min |
| limit edge | q − (best bid + 1 tick) | edge if a resting limit order fills (makers pay no fee) |

`q` is the model win chance at the side's mid (`best.win_prob`).

## Verdict rules
```
if no asks                         -> "no sellers"
if net ≥ min_edge and retention ≥ 0.5 -> "worth it"
elif net > 0                       -> "thin"         (most of the edge is eaten by the spread)
else                               -> "not worth it" (the spread costs more than the edge)
warning if model edge ≥ 15¢: "Edge looks too good: in testing, flags above 15¢ earned far less than predicted."
```
`min_edge` = 2¢ (config `flag_min_edge`).

## Where it runs
1. **Engine, at scan time** (`engine/execution.py`, already built): one `POST /books` batch for all
   flags; adds `execution` to each flag; flags sorted worth it → thin → rest, then by net edge.
2. **Web, live** (`/api/book?token=&q=&cat=&stake=`), TypeScript port of the same functions
   (`lib/execution.ts`), cached 5 s per token, used by the drawer, alerts and the extension.
   Port must match the Python on `engine/tests/fixtures/book_expected.json` (task T-12; pytest `engine/tests/test_execution.py` guards the Python side).

```ts
function check(q: number, book: Book, feeRate: number, minEdge: number, stakes = [25,100,500,1000]) {
  const asks = sortAsc(book.asks), bids = sortDesc(book.bids)
  if (!asks.length) return { verdict: "no sellers" }
  const ask = asks[0].price, bid = bids[0]?.price ?? null
  const mid = bid == null ? ask : (ask + bid) / 2
  const fee = feeRate * ask * (1 - ask)
  const gross = q - mid, net = q - ask - fee, retention = gross > 0 ? net / gross : 0
  const table = stakes.map(usd => { const f = fill(asks, usd, feeRate); return f && {
      stake_usd: usd, avg_price: f.avgPrice, edge: q - f.avgPrice - f.avgFee,
      expected_profit_usd: (q - f.avgPrice - f.avgFee) * f.shares, shares: f.shares } }).filter(Boolean)
  return { ...prices, gross, net, retention, capacity: capacity(asks, q, feeRate, minEdge),
           stakes: table, limit_price: Math.min(ask - tick, (bid ?? 0) + tick),
           verdict: net >= minEdge && retention >= 0.5 ? "worth it" : net > 0 ? "thin" : "not worth it" }
}
```

## How it shows up (labels per `06-ui.md` § Labels — "worth it" is an internal value, not UI copy)
- **Table** (flags view): Verdict column first; tooltip "Ask 72¢ vs mid 70.5¢: crossing the spread costs
  1.5¢ of your 25¢ edge (94% kept). Worth it up to about $2,400."
- **Drawer**: verdict card with a horizontal bar: `mid ── spread cost ── fee ── net edge ── win chance`,
  so the user sees what eats the edge. Stake table + custom stake input. "Prefer a limit order? At 71¢
  your edge would be +X¢ but it may not fill."
- **Filters**: verdict, min retention, min capacity (`04`).
- **Alerts**: `market_price` and `edge_change` rules use the live check, not the scan value.

## Backtest side
`engine/backtest.py` charges half of the live median spread for each niche and market type
(`spreads.json`) on top of the fee, so historical results are not computed at mid. `edge_buckets`
in `backtest.json` show predicted vs realized edge; flags carry `realistic_edge` from that table.
Known gap: historical spreads are not stored, so old thin markets may look better than they were.
The flag ledger (F-29) fixes this going forward by recording the real ask at flag time.
