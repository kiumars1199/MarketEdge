# Lane G (engine): evidence

Date: 2026-11-20. Worktree branch `worktree-agent-a88b18beb5a8ba04a` (with `overhaul` merged in).
The live runs used a scratch config: config/demo.json, plus `output_dir`/`data_dir` in scratch, plus `model.json`
and `backtest.json` copied from `origin/live`. Nothing was written to `output/`.

## G4: US-native scan (T-305)

The scan is behind `US_NATIVE_SCAN` (env; 1/true/yes/on) or config `us_native_scan` (default `false`). The env var wins.

- `engine/us_native.py` scores US-only markets in politics, culture, crypto, macro/finance and technology events.
  - Uses the model's yes/no node for category, niche and horizon.
  - Prices are the US bid/ask, with fee `0.095·p·(1−p)` (the market's own `fee` coefficient when it has one).
  - Category map: politics→politics, culture→culture, crypto→crypto, macro/finance→finance, technology→tech.
- Fetching reuses `pipeline/venue_us.py`:
  - `fetch_open` gives the open markets. It is cached once per scan and shared with the twin matcher, so there is no second `/v1/markets` crawl.
  - New `fetch_events` reads `/v1/events` per category for the event slug, event id, title and close.
  - New `book` reads `/v1/markets/<slug>/book`.
  - Markets already matched to an international twin are skipped.
- **Orientation fix:** the US `outcomes` order is unreliable. About half of politics/culture futures list "No" first, while bid/ask and settlement belong to `marketSides[].long`.
  - `fetch_open` now puts the long side first (`_long_first`). This also corrects the twin matcher for those markets.
  - Checked on settled markets: `cpc-btc-hitprice-low-yr-12-31-2026-75k` lists outcomes `["No","Yes"]` but has settlement 1, and Yes is long.
- **Close time** = the event `endDate`. A market's own `endDate` is its settlement deadline: +30 min for hourlies, about a week for gas weeklies.
- Native row shape:
  - `venue: "us"`, `id: "us-<id>"`, `event_id: "us:<event id>"`, `slug` = event slug, `market_slug` = market slug
  - `url = https://polymarket.us/event/<event slug>`, `tokens: ["",""]`
  - `us` = the US quote
- Execution comes from the US book, mirrored for the short side, through `execution.check` at the US fee.
- **Ledger:**
  - Native rows are logged with `venue: "us"` and graded only from `/v1/markets/<slug>/settlement`. They land in the `us` record, and `result`/`pnl` equal the US numbers.
  - They are never used as same-payout controls.
  - `events.json` skips them.
- `meta.us.native` = the number of native rows scored (0 when off).
- Tests are in `engine/tests/test_us_native.py`, on the real trimmed fixture `engine/tests/fixtures/us_native_markets.json`. They cover:
  - long-first orientation
  - the flag (env and config)
  - category, fee, link and close mapping
  - twin skip
  - markets outside an open event
  - book mirroring, enrich, and ledger booking and grading
  - `scan.run` end to end with the flag off (0 native) and on (4 native, 1 Best bet, logged as `venue: "us"`)
- Types and docs: `apps/web/lib/types.ts` and `docs/03-data-model.md` were updated together:
  - `Market.venue?`, `ScanMeta.us.native?`, `ScanMeta.capped?`, `LedgerEntry.venue?`
  - the UsQuote url comment

### Live run (flag on)

```
US_NATIVE_SCAN=1 python3 -m engine --config <scratch>/cfg_on.json scan
open markets fetched: 83116
polymarket us: 84703 open binary markets
polymarket us: 6785 of 24725 scanned markets are on Polymarket US
polymarket us: 8680 markets in open politics/culture/crypto/macro/finance/technology events
polymarket us native: 347 scored of 8747 open US markets in [...] (92 not in an open event)
order books checked: 2557
us order books checked: 19 of 19
ledger: 798 new rows
scanned 25072 markets, 2576 flags
```

Output summary:

```
meta.us {'ok': True, 'markets': 84703, 'matched': 6785, 'native': 347, 'best_on_us': 116, 'best_us_edge': 105}
native scored 347  crypto 207, finance 106, culture 30, tech 2, politics 2
  niches: finance 106, solana 62, ethereum 55, bitcoin 50, xrp 40, culture 30, tech 2, politics 2
  horizons: 6h 218, 168h 86, 72h 41, 24h 2
native flags 19   all tier "edge": culture 9, finance 8, politics 2   (verdicts: worth it 17, thin 2)
native Best bets 0  (only politics@168h is validated; its 2 rows have edge_low -0.146 < 0, so they fail the Best confidence bar)
validated native: politics 168h only (2 rows); crypto 6h, finance 6/24/72/168h, culture 72/168h, tech 72h are not
ledger: 798 rows, 0 native (only Best bets are logged)
```

First results (top native flags by edge; the link is the code-generated URL):

| tier | cat | market | side | ask | fee | p | edge | verdict | link |
|---|---|---|---|---|---|---|---|---|---|
| edge | finance | US Diesel Prices This Month: Above $5.70 | No | 73¢ | 1.9¢ | 0.855 | 10.6¢ | worth it | /event/usdsl-month-2026-11-30 |
| edge | finance | How Low Will US Gas Prices Get This Month?: Below $3.50 | Yes | 64¢ | 2.2¢ | 0.748 | 8.6¢ | worth it | /event/usgas-lowm-2026-11-30 |
| edge | finance | US Diesel Prices This Month: Above $5.60 | Yes | 80¢ | 1.5¢ | 0.892 | 7.6¢ | worth it | /event/usdsl-month-2026-11-30 |
| edge | finance | Alaska Diesel Prices This Month: Above $6.00 | No | 78¢ | 1.6¢ | 0.860 | 6.4¢ | thin | /event/akdsl-month-2026-11-30 |
| edge | politics | Taipei Mayoral Election Winner: Chiang Wan-an | Yes | 62¢ | 2.2¢ | 0.699 | 5.7¢ | worth it | /event/twmayor-taipei-2026-11-28 |
| edge | culture | Top US Netflix Movie This Week?: Guarding Stars | Yes | 71¢ | 2.0¢ | 0.779 | 4.9¢ | worth it | /event/ntflx-1movus-2026-11-24 |
| edge | culture | Dancing With The Stars S35 Third Place: Tatyana Ali | No | 75¢ | 1.8¢ | 0.812 | 4.5¢ | worth it | /event/dwts-s35-3-2026-11-24 |

Caveats:

- Ladder and range markets (gas/diesel thresholds, crypto price buckets) are scored one by one as yes/no. The model doesn't see that the buckets are linked.
- An earlier run, before close times came from events, used market endDates. It put crypto hourlies at 1h and flagged 40 crypto longshots with 10–12¢ model edges. With event closes, crypto lands at 6h and has no flags.

## G5: cap Best bets per game (T-306)

- Config `max_best_per_event` (default 2; set in config/demo.json). Falsy means no cap.
- `engine/scan.cap_per_event(flags, k, held)` runs after selection, on the final `is_best` flags.
  - Groups by `event_id` (falls back to `id`).
  - Lines already held in the ledger for the event keep their slots (`ledger.held_by_event`). The remaining slots go to the best new lines by the scan's ranking (`rank_key`: verdict "worth it" < "thin" < rest, then net edge).
  - Capped lines drop to the Edge tier when they still pass `is_edge` with a live book.
  - `meta.capped` counts the capped lines.
- `engine/backtest.cap_mask` applies the same cap to the walk-forward flag selection, per (event, horizon), ranked by q − cost.
- Tests are in `engine/tests/test_best_cap.py`.
- Live (same run): tiers best 798 / edge 1778. 589 Best bets were capped. Max 2 Best per event across 459 events.
- Not run: the backtest. There is no `data/` here. The cap may change the backtest records, and so `validated`, on the next run.

### Retroactive on origin/live ledger.jsonl

Command: `python3 scripts/ledger/cap_check.py <ledger.jsonl>`.

- The ledger has 2,687 rows and 862 graded. Event ids were recovered from Gamma and cached next to the ledger.
- Stats are on the "first" basis: one row per market and side.
- "best" keeps the 2 per event that the scan's ranking would pick. "first" keeps the first 2 flagged.

```
rule          scope      settled  events  wins   per bet  per event   roi %
no cap        all            593     178   472   -0.0056    -0.0088    -0.7
no cap        sports         260      69   205   -0.0222    -0.0291   -2.74
no cap        weather        333     109   267    0.0074     0.0041    0.93
cap 2 best    all            317     178   248    0.0164     0.0108    2.14
cap 2 best    sports         108      69    82    -0.027    -0.0343   -3.43
cap 2 best    weather        209     109   166    0.0388     0.0393    5.14
cap 2 first   all            317     178   243   -0.0071    -0.0101   -0.91
cap 1 best    all            178     178   133   -0.0061    -0.0061   -0.81
cap 3 best    all            414     178   324     0.002    -0.0076    0.25
```

The full table is in `cap_check.txt`. The cap halves settled bets (593 to 317) over the same 178 events. Per bet, results go from −0.56¢ to +1.64¢; per event, from −0.88¢ to +1.08¢.

The improvement is noisy and not monotonic in k. Cap 1 and "first 2" both lose, so treat the result as weak evidence. The cap does mainly what it is meant to do: it stops one game's 10+ correlated lines from dominating.

## G6: link check (T-307)

Script: Playwright from `apps/web`.
- Desktop: Chromium `/opt/pw-browsers/chromium` at 1440×900.
- iPhone: WebKit `devices['iPhone 15']`.

Raw results are in `linkcheck.json` and screenshots in `shots/`.

| URL | desktop | iPhone 15 |
|---|---|---|
| `/market/aec-nba-hou-den-2026-11-20` (old pattern) | 307 to `/`, home page "Polymarket US \| Trade on sports, politics, and more", no market | 307 to `polymarket-app.onelink.me/...` (app install; Playwright: "Download is starting") |
| `/market/aec-nba-zzz-qqq-2026-11-20` (bogus) | same home page | same |
| `/event/nba-hou-den-2026-11-20` | redirects to `/sports/nba/nba-hou-den-2026-11-20`, 200, "HOU Rockets vs. DEN Nuggets \| Polymarket", teams and prices shown | same |
| `/event/company1-2026-12-31` | 200, "Which Company Has #1 AI Model end of 2026?", OpenAI 85% | same |
| `/event/btc-hit-h-w-2026-11-20` | 200, "How high will BTC get by 5:00PM ET on Fri, Nov 20?" | same |
| `/event/zzz-not-real-2026` (bogus) | 200 shell, "Page not found" | same |
| code-generated twin `/event/nfl-tb-det-2026-11-22` | redirects to `/sports/nfl/...`, 200, "TB Buccaneers vs. DET Lions", teams found | same |
| code-generated native `/event/usdsl-month-2026-11-30` | 200, "US Diesel Prices This Month", lines and prices shown | 200, same title; body shows "US DIESEL PRICES THIS MONTH … Yes: 98%" (the case-sensitive word check missed the upper-case heading) |

**Verdict:** `/market/<slug>` does not open the market. `US_URL` is now `https://polymarket.us/event/{slug}`, which takes the event slug.

How the event slug is found:
- Sports twins: the game key of the market core (`aec-nba-hou-den-2026-11-20` gives `nba-hou-den-2026-11-20`).
  - It held for all 6,744 twins in the earlier run.
  - 60 of 60 sampled were confirmed via `/v1/events/slug/<key>`.
- Native rows: the event's own slug from `/v1/events`.
- A twin with no game key falls back to `https://polymarket.us/`. That can't happen for sports twins today, and it is never a wrong market.

Tests updated: `engine/tests/test_venue_us.py` and `apps/web/test/us-gate.test.ts`.

## Gates

- `python3 -m pytest -q engine/tests`: 91 passed. Each commit's tree was also tested alone: T-307 74, T-305 85, T-306 91.
- `cd apps/web && pnpm lint`: clean. `pnpm typecheck`: clean.
- `pnpm test`: 696 of 697 passed.
  - The one failure is `test/api.test.ts > apply() timing > p95 < 150 ms over 15k rows`. It measured 371/750 ms with a load average of about 17 on 4 shared CPUs, while other lanes were running.
  - It passes when run alone: `pnpm vitest run test/api.test.ts test/funnel-db.test.ts` gave 12/12.
  - It is not touched by this lane, which made no change to apps/web code beyond types.ts and the us-gate URL literal.
- The full e2e suite was not run, per the brief.
