# Kismet spec

| # | Doc | What it answers |
|---|---|---|
| 01 | [Product](01-product.md) | Who it's for, tiers, demo vs paid scope, compliance guardrails |
| 02 | [Architecture](02-architecture.md) | Systems, data flow, hosting, env vars, refresh cadence |
| 03 | [Data model](03-data-model.md) | Engine output types, topic taxonomy, database tables |
| 04 | [Filters & search](04-filters.md) | Every filter and sort, Kalshi/Polymarket parity, URL state, pseudocode |
| 05 | [Features](05-features.md) | Every feature with pseudocode and acceptance checks |
| 06 | [UI](06-ui.md) | Every page and component, layouts, empty/loading/error states |
| 07 | [Execution check](07-execution.md) | Ask vs mid, order-book depth, stake table, verdicts |
| 08 | [Auth & billing](08-auth-billing.md) | Supabase auth, Stripe tiers, feature gates |
| 09 | [Chrome extension](09-extension.md) | Premium overlay on Polymarket/Kalshi pages |
| 10 | [Tasks](10-tasks.md) | Ordered build backlog for agents, in parallel lanes |
| 11 | [Research](11-research.md) | Competitors, feature parity, sources |
| 12 | [Test plan](12-test-plan.md) | Unit, e2e smoke flows, data checks, launch checklist |
| 13 | [Search & filters v2](13-search-and-filters-v2.md) | Smart search, live suggestions, simple filters, Best bets home |
| 14 | [Launch](14-launch.md) | Accounts, Stripe placeholders, legal pages, hosting, ops, pre-launch audit |
| 15 | [Security](15-security.md) | Threat model and the security checklist |
| 18 | [Multipliers and combos](18-multipliers-and-combos.md) | Two tiers, Pays filter, clean counts, combos, longer backtest |
| 19 | [Polish round](19-polish-round.md) | Landing, onboarding, free tier, clearer numbers, speed, UI, admin grants |
| — | [Overnight run](OVERNIGHT.md) | The full final-product build + final audit prompt |
| 16 | [Kalshi trading](16-trading.md) | Placing Kalshi trades: rules, design, paper-trading build behind a flag |
| 17 | [UI polish](17-ui-polish.md) | Fixes from screenshots + all-day usefulness |
| — | [Agent prompts](AGENT_PROMPTS.md) | Copy-paste prompts for Claude Code, one per lane |

Engine docs: the repo `README.md` (model, backtest, outputs).

Build status: see [STATUS.md](../STATUS.md).
