# Kismet

Flags prediction-market contracts whose **true win chance beats their price after fees**,
learned from how hundreds of thousands of past markets actually resolved, weighted toward
recent trading so the numbers stay current.

**Building the app?** Start with `CLAUDE.md` and `docs/README.md` (full spec, task backlog,
agent prompts in `docs/AGENT_PROMPTS.md`). Live data for the app is on the `live` branch.

Polymarket only for now: its data is public and needs no key.
Kalshi comes later, once Kalshi gives written permission to use its data.

## Quick start

```bash
pip install -r requirements.txt
python pipeline/fetch_closed.py                          # one-time: resolved-market universe (~5 min)
python pipeline/fetch_prices.py --per-niche 25000        # one-time: pre-resolution prices (~45 min, resumable)
python -m engine backtest   # walk-forward test; also picks how fast old data fades
python -m engine fit        # fit the model           -> output/model.json
python -m engine scan       # score all open markets  -> output/markets.json, flags.json
python -m engine all        # day-to-day: update + fit + scan
```

One config file = one instance (`config/demo.json`). A new instance (another platform,
different thresholds, a narrower niche set) is a new config file, not new code.

## How the engine works

```
pipeline/fetch_closed.py   resolved binary markets, sampled by category tag and end date
pipeline/fetch_prices.py   price 1h / 6h / 24h / 72h / 7d before each market resolved
engine/update.py           incremental: markets resolved since the last run (no sampling cap)
engine/dataset.py          -> bets: buy side A at p, or side B at 1 - p
engine/model.py            hierarchical, recency-weighted calibration model
engine/backtest.py         walk-forward test, using live spreads as trading cost
engine/scan.py             scores every open market, writes the UI files
.github/workflows/refresh.yml   runs update + fit + scan every 2 hours, publishes to the `live` branch
```

**Model.** For a contract priced p, the true win probability is modelled as
`q = sigmoid(theta · [1, x, (x-k1)+, (x-k2)+, (x-k3)+])` with `x = logit(p)`, knots at 30¢/50¢/70¢.
A perfectly priced market has `theta = [0, 1, 0, 0, 0]`. There is one `theta` per segment and
per horizon (hours before resolution), in a tree:

```
all  ->  category  ->  niche  ->  niche + market type
```

Each segment is pulled toward its parent, so small niches borrow strength from their category,
and big niches speak for themselves. This covers every price (not just 5¢ buckets with enough
data), which is what lets the scanner score all ~15,000 open markets.

**Staying current.** Every past bet is weighted `0.5 ** (age_days / half_life)`. The walk-forward
test tries several half-lives (21, 45, 90, 180 days and no decay) and the engine uses the winner.
`update` pulls every newly resolved market, so the newest results enter the model on each run.

**Honest uncertainty.** Markets from one game or one weather day move together, so the
standard errors are inflated by the within-event design effect. A market is flagged only if
the edge is at least 2¢, the pessimistic (80% one-sided) edge is still above zero, **and** the
market's category and time-to-close both made money in the walk-forward test (`validated`).
`markets.json` still carries every market's numbers, so the UI can show unvalidated ones too.

**No look-ahead.** A snapshot uses only a price observed at or before (resolution − N hours),
and the market must already have traded at 3+ distinct prices. Events are sampled by end date,
never by volume (final volume leaks the outcome). The walk-forward test fits only on markets
that resolved before each test week.

**Real trading costs.** Live edges are charged at the current **ask** plus the Polymarket taker
fee (`rate × p × (1 − p)`, rate by category). The backtest charges half of the live median
spread for each niche and market type (`output/spreads.json`), never less than 0.5¢.

## Output files (the UI reads these)

All in `output/`, refreshed every 2 hours on the `live` branch.

### `flags.json`: the shortlist
```jsonc
{
  "meta": { "instance": "demo", "platform": "polymarket", "scanned_at": 1794869081,
            "model_half_life_days": 60, "markets_scanned": 15432, "flags": 1883,
            "rule": { "min_edge": 0.02, "confidence_z": 1.28, "price_range": [0.05, 0.95] } },
  "flags": [ /* same shape as markets[] below, sorted by best.edge */ ]
}
```

### `markets.json`: every scanned open market (search and filter over this)
```jsonc
{
  "id": "6639700",                     // Polymarket market id
  "question": "Colts vs. Texans: O/U 44.5",
  "event": "Colts vs. Texans", "event_id": "123",   // group rows by event
  "url": "https://polymarket.com/event/nfl-ind-hou-2026-11-20",
  "category": "sports",                // sports | crypto | politics | finance | culture | weather | tech | geopolitics | other
  "niche": "nfl",                      // nfl, nba, cfb, soccer, tennis, esports, bitcoin, weather, elections, ...
  "market_type": "totals",             // moneyline | spreads | totals | props | yes/no | multi-outcome
  "tags": ["sports", "nfl", "..."],
  "hours_to_close": 75.7, "closes_at": 1795000000, "horizon_h": 72,
  "volume": 225.0, "liquidity": 40249.1, "spread": 0.01,
  "validated": true,                   // this category AND time-to-close made money in the walk-forward test
  "backtest": { "flags": 663, "pnl_cents": 15.47, "t": 15.98 },   // category track record
  "sides": [ {                         // one entry per outcome
    "outcome": "Under",
    "ask": 0.52, "mid": 0.515, "fee": 0.0125,
    "win_prob": 0.59, "win_prob_low": 0.56,     // model estimate, and pessimistic estimate
    "edge": 0.0525, "edge_low": 0.0225,         // per $1 share, after fee, at the ask
    "roi_pct": 9.9,
    "model_level": "niche",             // which tree level answered: all | cat | niche | nmt
    "model_neff": 812.4, "model_events": 190    // how much data stands behind it
  } ],
  "best": { /* the side with the higher edge */ }
}
```

### `model.json`
Every segment's fitted curve: `win_prob_at_price` maps price → modelled win chance
(for the "why is this flagged" chart), plus sample sizes and the chosen half-life.

### `backtest.json`
Walk-forward results per half-life: flags, win rate, cents per share, ROI, clustered t-stat,
split by category, horizon and week. The UI can show this as the track record.

## UI requirements (from the scoping doc)
- Filters: category, niche, market type, price range, min edge, hours to close,
  liquidity, max spread, model confidence (`edge_low > 0`). Sort by edge, ROI, closing time.
- Saved presets and saved dashboards; "Favorite topics" setting (topic level only).
- Group by `event`: one game can produce many correlated flags.
- Show the same data to everyone. Never generate picks from a user's own positions.
- Disclaimer on every page: not financial advice, based on past results, 18+.

## Automation
`.github/workflows/refresh.yml` runs every 2 hours: restore history from the Actions cache
(the first run bootstraps it, about an hour), `update`, a daily `backtest`, `fit`, `scan`,
then force-pushes `output/*.json` to the `live` branch. The UI can read them from there
(private repo: use a GitHub token in the UI's server-side fetch).
