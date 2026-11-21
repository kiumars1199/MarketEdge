# 05 · Features

Each feature: what it does, how (pseudocode where logic matters), and acceptance checks.
Tier tags: **[F]** free, **[P]** Pro, **[PR]** Premium, **[D]** in tonight's demo.

---
## F-01 Screener table [F][D]
All open markets with Kismet numbers, one row per market (or per event group).

Default view = cards (Best bets) or rows (All markets), using the plain-language numbers in
`06-ui.md` § Display language: Expected return % · Bet {outcome} at {price} · Market says vs Won
before · $100 → expect +$X · chance label · closes in · topic · save. Row columns: ☆ · Market ·
Bet · Expected return · Won before · Market says · Chance · Closes · Topic. Optional columns: Mid, Spread, Fee, Volume, 24h volume, Liquidity,
Evidence (events), Model level, Market type, Retention, Capacity, Verdict, Realistic edge.

Behavior
- Virtualized rows (TanStack Virtual), server pagination 50/page, infinite scroll.
- Row click → drawer (F-04). ☆ → watchlist (F-09). Cmd/Ctrl-click → open on Polymarket.
- Return color: ≥ 10% strong green, 3–10% green, 0–3% grey, < 0 red. Pro mode swaps in ¢ edge.
- Header shows: "15,483 markets · scanned 12 min ago · next scan ~1 h 48 m" (F-24).
- Sticky filter bar; column resize and reorder saved with the preset.

Accept: loads < 1.5 s on a cold cache with 15k markets; sort by any column; filters change URL;
back button restores state; mobile shows a card list instead of the table.

## F-02 Search [F][D]
Search box (`/` to focus). Matches question, event, outcome, tags; paste a Polymarket URL to jump
to that market. Debounced 200 ms, server-side (`04` § Search). Shows "No matches in open markets"
with a "clear filters" button when filters hide results.

## F-03 Filters panel + quick chips [F][D]
Left sidebar on desktop, bottom sheet on mobile. Sections in this order:
1. **View**: Markets | Flags
2. **Topics**: taxonomy tree with checkboxes and counts; search-in-tree; "favorites" pinned on top
3. **Market type**: moneyline, spreads, totals, props, yes/no, multi-outcome; period (full/1H/1Q…)
4. **Price & odds**: side selector (best / yes / no / favorite / underdog); price range slider 0–100¢;
   min win chance
5. **Edge**: min edge (¢), confident only, min ROI, validated only, min evidence (events)
6. **Execution** (flags view): verdicts, min retention, min capacity $
7. **Time**: closes within (1 h / 6 h / 24 h / 3 d / 7 d / custom), closes after, live only, frequency
8. **Activity**: min volume, min 24h volume, min liquidity, max spread
9. **Mine**: watchlisted only, favorite topics only
Footer: "Reset" · "Save as preset". Applied-filter pills above the table, each removable.
Gate: Free sees sections 1–4 (5–9 locked with a Pro badge and a one-line upsell).

## F-04 Market drawer [F][D]
Opens from the right (full screen on mobile). Sections:
1. **Header**: question, event, venue link "Open on Polymarket ↗", closes at (local time + countdown), watch ☆, alert 🔔, share.
2. **Both sides** side by side: outcome, ask, mid, win chance (range: low–estimate), edge, ROI. Best side highlighted.
3. **Headline card**: "Bet YES at 68¢ · +33% expected return · similar past bets returned +24%".
   Price check line (F-05) only calls attention when the spread or capacity is a problem (`06` labels).
4. **Stake table** (F-05): $25 / $100 / $500 / $1000 → avg price, edge, expected profit; capacity line.
5. **Why**: chart of the segment's win-chance curve (`/api/model/curve`) vs the 45° "fair" line,
   with this market's price marked; text: "Past markets like this (NFL · totals · ~24 h out, 812
   effective samples from 190 events) won 59% of the time at this price."
6. **Track record** of the segment: backtest flags, avg ¢/share, t-stat; "validated" badge or a warning.
7. **Warnings**: wide spread, thin book, edge > 15¢ ("looks too good"), small evidence (< 50 events),
   model fell back to a broad level (`model_level` = all/cat).
8. **Log this bet** (F-12) [P] and **Sizing** (F-13) [P].
9. Other markets in this event (links).

## F-05 Execution check (ask vs mid) [P][D]
See `07-execution.md`. In the drawer the check runs live (`/api/book?token=`), refreshing every 5 s
while open; in tables it shows the scan-time verdict with its age. Free shows only the verdict word.

## F-06 Flags page [F][D]
The validated shortlist: `view=flags` with grouping by event and the verdict column first.
Cards on mobile. Top strip: counts by verdict and by category; "realistic edge" explained in a tooltip.
Free: first 3 flags of the day unlocked (by user/day, stored locally for anonymous), rest blurred with upsell.

## F-07 Presets [F 1][P 25][PR ∞][D]
Save the current FilterState + sort + columns under a name (and emoji).
- Preset bar above the table: built-in presets (`04` § Presets), then user presets; drag to reorder.
- Actions: save, save as new, rename, duplicate, delete, set as default (opens on login), share link
  (URL with the state; the receiver can "save to my presets").
- Dirty state: when filters differ from the active preset, show "• modified · Save · Revert".
```ts
savePreset(name) { assertQuota(user.tier, count('presets')); repo.presets.insert({name, query: state, sort, columns}) }
applyPreset(p)  { setState(migrate(p.query)); router.replace(toUrl(state)) }   // migrate() handles v bumps
```
Accept: presets survive reload (local in demo, DB in paid); quota enforced server-side; shared link opens identical view.

## F-08 Favorite topics [F][D]
Chosen in onboarding (F-19) or settings: a topic grid (taxonomy level 2) with counts of open markets.
Used for: pinned chips, `favorites_only` filter, default sort of the Flags page (favorites first),
alert suggestions. Topic level only, never computed from the user's bets (product rule).

## F-09 Watchlist / saved bets [F 10][P ∞][D]
Save a market or one side of it, optionally with a note and a target price.
- Saves a `snapshot` (ask, win chance, edge, at time saved) so the list shows "since saved: ask 68→71¢,
  edge 5.2→3.1¢".
- Watchlist page: table with the same columns + "since saved" + status (open / closing soon / resolved:
  won/lost). Bulk remove. Filters reuse FilterState with `watchlisted_only`.
- Target price → creates a `market_price` alert rule automatically [P].
Accept: star toggles instantly (optimistic), works logged out (local), merges on login.

## F-10 Dashboards [P 3][PR ∞]
A page with a grid of panels (react-grid-layout). Panel kinds:
`preset_table` (a preset's live results, compact), `watchlist`, `kpi` (count of flags / best edge /
markets closing in 6 h for a preset), `calibration_chart` (segment curve), `journal_summary` (P&L, CLV),
`alerts_inbox`. Each panel has its own refresh (follows scan) and "open full view".
```ts
layout: [{ panel_id, kind, preset_id?, query?, x, y, w, h, title? }]
```
Accept: create/rename/delete dashboards; drag-resize persists; works on mobile as a stacked list.

## F-11 Alerts [P][PR]
Rule kinds:
| Kind | Fires when | Params |
|---|---|---|
| `preset_match` | a market newly matches a preset/FilterState | query, min edge, max per run |
| `market_price` | a watched side's ask ≤ target | market_id, side, threshold |
| `edge_change` | a watched side's edge crosses a threshold up or down | market_id, side, threshold |
| `closing_soon` | a watched market closes within N hours | hours |
Channels: email, web push [P]; Telegram/Discord webhook [PR]. Cooldown per rule (default 60 min),
quiet hours, daily digest option.
Evaluator (`/api/alerts/run`, Vercel Cron every 5 min, also triggered after each scan):
```ts
for rule of activeRules():
  candidates = match(rule)                         // preset_match: apply(store, rule.query)
  if rule.kind in (market_price, edge_change):     //  -> live book for the one token
     candidates = liveCheck(rule)
  for c of candidates.slice(0, 10):
     key = `${rule.id}|${c.market_id}|${c.side}|${bucket(now, rule.cooldown_minutes)}`
     if insertAlertEvent({dedupe_key: key, payload: summary(c)}) succeeded:   // unique key = dedupe
        send(rule.channels, render(c))            // email via Resend, push via web-push, webhook POST
  update rule.last_fired_at
```
Message: "Kismet · NFL · Jaguars vs Giants · Jaguars 72¢ · win chance 79% (76–82) · edge +5.1¢ ·
worth it up to ~$2,400 · closes Sun 1:00 PM" + link to drawer. Never says "bet this".
Accept: no duplicate sends within cooldown; disabled rule never fires; unsubscribe link in every email.

## F-12 Bet journal + CLV + P&L [P]
Manual log of bets the user placed (no wallet connection in v1).
- "Log this bet" in the drawer pre-fills market, side, price (current ask), Kismet win chance/edge;
  user enters shares or $ and can edit price.
- Settlement job (daily, server): for each open journal row whose market resolved, fetch result from
  Gamma (`/markets/{id}` outcomePrices) → set result, pnl = shares × (1 − price − fee) or −shares × (price + fee).
- **Closing line value (CLV)**: closing_price = the side's last price before close (prices-history);
  CLV = closing_price − entry price. Positive CLV over many bets is the best early sign of skill.
- Journal page: table + summary tiles (bets, staked, P&L, ROI, win rate, avg CLV, avg Kismet edge at
  entry) + charts (cumulative P&L, P&L by category/topic, edge at entry vs realized), CSV import/export.
Accept: P&L math unit-tested; voids return stake; timezone-correct dates.

## F-13 Sizing (Kelly) [P]
Calculator in the drawer using the user's own bankroll and Kelly fraction from settings.
```ts
// buying at price p (incl. fee) with true win chance q, payout $1/share
f_star = (q - p) / (1 - p)                       // full-Kelly fraction of bankroll
stake  = bankroll * kelly_fraction * max(0, f_star)
stake  = min(stake, execution.capacity_usd)      // never above what the book supports
shares = stake / p
```
Shows "Quarter-Kelly suggests $X (Y shares). At $X the average fill is Z¢ and edge W¢." Uses
win_prob_low by default ("conservative") with a toggle to estimate. This is sizing math on the
user's own inputs, not a pick; the copy says so.

## F-14 Track record & methodology [F][D]
Public page built from `backtest.json` (and later the flag ledger, F-29):
- Headline tiles: flags tested, avg ¢ per $1 share, ROI, t-stat, events; versus "every bet, no filter".
- Weekly fold chart (bars: flags count; line: ¢/share), by category table, by time-to-close table.
- "Do predicted edges come true?" chart from `edge_buckets` (predicted vs realized).
- Calibration chart per category (`model.json` curves vs fair line).
- Plain limitations box: historical price = mid; spreads estimated; weather history only ~3 weeks; small samples.
- Methodology section (how the model works, in plain words).

## F-15 Calculators [F][D]
Tabs: **Edge/EV** (price, win chance, fee rate → edge, ROI, break-even win chance) · **Payout**
(price ↔ multiplier ↔ implied % ↔ American/decimal odds) · **Fee** (Polymarket formula by category) ·
**Kelly** (F-13 math, bankroll input) · **Parlay-free multi-bet EV** (sum of independent bets).
All client-side, unit-tested.

## F-16 Event page [F][D]
`/event/[id]`: all markets of one event (game, weather day, election) with the same table, sorted by
edge; header with event time and a summary "6 of 41 markets flagged". Weather events also show a
bucket chart (temperature buckets with price vs win chance).

## F-17 Display settings [F]
Odds format (¢, %, decimal, American), density (comfortable/compact), timezone, theme (dark/light),
default columns. Stored in profile (paid) or local.

## F-18 CSV export [P]
Export current view (respecting filters) as CSV, max 5,000 rows.

## F-19 Onboarding [F][D-lite]
3 steps, skippable: (1) "What do you trade?" topic grid → favorite topics; (2) "How do you trade?"
market vs limit orders, typical stake → default stake & execution display; (3) 30-second tour
(flags, drawer, presets). Ends on the Flags page filtered to favorites.

## F-20 Landing + pricing [F][D]
Landing: headline ("Same payout. Different odds."), 3-step explainer, live counter (markets scanned,
flags now, track record tiles), 2 screenshots, FAQ (what is edge, is this advice — no, how is it
tested, which venues), pricing table (`01`), footer disclaimer. Pricing page with monthly/annual toggle.

## F-21 Auth & account [P]
Supabase Google, email + password, magic link. Settings: profile, display (F-17), bankroll & Kelly (F-13), favorite
topics, notifications (channels, quiet hours, digest), connected webhooks, data export/delete account.

## F-22 Billing & gates [P]
See `08-auth-billing.md`. Feature flags read from `subscriptions.tier` via `useEntitlements()`.

## F-23 Notification inbox [P]
Bell in the header: last 50 `alert_events`, unread count, mark all read, click → drawer.

## F-24 Freshness & status [F][D]
Header pill: "Scanned 12 min ago". Turns amber > 3 h, red > 6 h with "data may be stale".
`/status` page: last scan, last fit, last backtest, markets scanned, book checks, engine errors (from meta).

## F-25 Chrome extension [PR]
See `09-extension.md`.

## F-26 Share [F]
Share a market or a view as a link (+ OG image card with question, price, win chance, edge). The
receiver sees the same view; gated numbers stay gated.

## F-27 Keyboard [F]
`/` search · `j/k` move · `enter` open · `w` watch · `a` alert · `f` filters · `g f` flags · `g w` watchlist · `?` help.

## F-28 Ops page [internal]
`/admin` (allow-listed emails): scan health, counts by category over time, alert send volume,
Stripe MRR, error log. Feature flags toggles.

## F-29 Flag ledger = live track record [F] (engine task)
Every scan appends each flag (market, side, ask, win_prob, edge, verdict, time) to
`output/ledger.jsonl` (deduped: first time a market/side is flagged, plus later re-flags at a better
price). A daily job grades resolved ones (win/loss, realized edge, CLV vs closing price). The Track
record page shows **live forward results** next to the backtest. This is the strongest trust feature;
start it on day 1 so the record exists by launch.
```python
on scan:  for f in flags: if (f.id, f.side) not in ledger_open: ledger.append(entry(f, now))
daily:    for e in ledger_open: m = gamma.market(e.id); if m.closed: grade(e, m); close(e)
grade:    pnl = (won ? 1 : 0) - e.ask - e.fee; clv = closing_price(e) - e.ask
```

## Later (not in v1)
Kalshi venue (after permission) · cross-venue price comparison · large-trade feed · mobile PWA install
+ push · team/shared dashboards · public API · AI "why this market moved" summaries.
