# 01 · Product

## One line
Kismet is a screener for Polymarket (and later Kalshi) that shows which contracts are
priced **below their real win chance**, after fees and after the cost of buying at the ask,
with the evidence behind every number.

## Who it's for
| User | Wants | What Kismet gives them |
|---|---|---|
| Active sports bettor on Polymarket | Better prices on games they'd bet anyway | Niche filters (league, market type), edge on each side, stake table |
| Weather / niche trader | Fast scan of daily markets | Weather filters (city, high/low, day), live flags 6–24 h out |
| Casual trader | "Is this bet any good?" | Win chance vs price, plain-English verdict, extension badge |
| Data-minded trader | Proof | Backtest record, calibration charts, sample sizes |

Not for: market makers, high-frequency bots, copy-trading/whale watchers (out of scope at launch).

## Core promise, in the app's own words
"Same 2x payout, different odds. We show which ones historically win more often than their
price says, after fees, and whether you can actually get that price right now."

## Tiers
| | Free | Pro $11.99/mo | Premium $19.99/mo |
|---|---|---|---|
| Market screener (all open markets) | Yes, 15-min delay, top 10 rows per view; Best bets: 10 a day, a random sample per user per day (docs/19 P3) | Live, unlimited | Live, unlimited |
| Win chance + edge on each market | Edge shown as a range ("2–5¢") | Exact | Exact |
| Flags (validated shortlist) | 3 per day revealed | All | All |
| Filters | Category, niche, price | All (`04-filters.md`) | All |
| Saved presets | 1 | 25 | Unlimited |
| Dashboards (multi-panel) | — | 3 | Unlimited |
| Watchlist / saved bets | 10 | Unlimited | Unlimited |
| Alerts | — | Email (server check once a day) + browser while the tab is open, 20 rules | Same as Pro, 100 rules. Telegram/Discord not sold: the editor can't store a webhook (#64, Nov 20) |
| Execution check (order book, stake table, capacity) | First-share verdict only | Full | Full |
| Bet journal + CLV + P&L | — | Yes | Yes |
| Track record / calibration pages | Yes | Yes | Yes |
| Chrome extension badges | — | — | Yes |
| CSV export | — | Yes | Yes |

7-day free trial on Pro and Premium. Prices (owner, Nov 18): Pro $11.99/mo or $99.99/yr, Premium $19.99/mo or $169.99/yr
(`config/site.json` → `prices_usd`).
Prices are a starting point (`11-research.md` has competitor pricing).

## Demo scope (tonight): every user-facing feature, no paid plumbing
The demo includes **every feature a paying user would see**, running in `DEMO_MODE=true`:
no login, no Stripe, tier forced to Premium, user data in `localStorage` (`LocalRepo`).
| Feature | Demo behavior | Paid version adds |
|---|---|---|
| Screener, search, all filters, grouping (F-01..F-03) | full | — |
| Drawer + live execution check + stake table (F-04, F-05) | full | — |
| Flags, event pages, share links, OG images (F-06, F-16, F-26) | full | — |
| Presets, favorite topics, watchlist (F-07..F-09) | full, saved locally | saved to account, synced across devices |
| Dashboards (F-10) | full, saved locally | synced |
| Alerts (F-11) | rules editor + in-app inbox + browser notifications, evaluated in the open tab every 2 min | server cron, email, web push when the tab is closed, Telegram/Discord |
| Bet journal + CLV + P&L (F-12) | full, settlement runs on page load via `/api/settle` | nightly server settlement |
| Kelly sizing, calculators (F-13, F-15) | full | — |
| Track record + methodology (F-14), flag ledger (F-29) | full | — |
| Display settings, keyboard, CSV export, onboarding (F-17..F-19, F-27) | full | — |
| Landing + pricing (F-20) | full; "Start trial" buttons go to `/markets` | Stripe checkout |
| Chrome extension (F-25) | full, pointed at `http://localhost:3000` | store build, token auth |
| Auth, billing, gates, admin (F-21, F-22, F-28) | **not in demo**; `<UpgradeGate>` exists but always passes | real |

## Paid v1 (right after the demo)
Swap `LocalRepo` → `SupabaseRepo`, add auth, Stripe, entitlements (gates already in place), server-side
alert delivery, extension token auth, admin. No UI rebuild needed.

## Later
Kalshi (after written permission), cross-venue comparison, whale/large-trade feed, mobile PWA polish,
team accounts, public API.

## Compliance guardrails (product rules, not legal advice)
- **No personalized picks.** Flags, edges and verdicts are computed the same for every user.
  Users choose their own filters, presets and favorite topics (topic level only). The app never
  reads a user's positions to tell them what to buy. Showing a user's own positions or journal
  next to market data is fine.
- **No auto-trading, no order placement** in the app or extension. Links open the market on the venue.
- **No profit promises.** Copy says "historically", "estimated", "based on past results".
  The backtest page shows losses and limitations as plainly as wins.
- **18+**, disclaimer on every page and in the extension popup, ToS acceptance at signup.
- **Kalshi data only with written permission** (their Developer Agreement bans commercial reuse).
  Polymarket data is public.
- Positioning everywhere: "market analytics", not "tips" or "picks".
