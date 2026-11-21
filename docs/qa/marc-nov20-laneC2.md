# Marc's QA list (Nov 20, 2026): lane C2 log

Lane C2 items (taken from lane C): 23, 64 (alerts) and 38, 58, 72 (AI connector allowance).
Branches are stacked: `claude/qa-c2-alerts`, then `claude/qa-c2-connector` on top of it. "Verified in mock" = the paid
e2e mock (DEMO_MODE=false, app/e2e-mock Supabase + Stripe). No Resend, Supabase, Stripe or Vercel calls were made.

## QA-C2 1: #23, #64 alerts (branch claude/qa-c2-alerts)

What was already there: the server evaluator (`lib/alerts-server.ts`) behind `/api/alerts/run` already emails rules
whose `channels` include `email` (Resend, one-click unsubscribe) and posts Discord/Telegram webhooks for Premium. But
the alert editor only ever saved `[]` or `["push"]` and never a webhook URL, so no rule could reach email, Telegram or
Discord: all three were sold and none was deliverable. The Vercel cron runs **once a day** (`"0 13 * * *"`,
apps/web/vercel.json; ops.md: Hobby rejects sub-daily crons), while the route comment said "every 5 min".

| Item | Status | Evidence |
|---|---|---|
| 23 /alerts blank on first load | **Not reproduced in mock; hardening shipped; not verified live** | Correction (supersedes the first report to main, which said fixed): signed-in Pro on the paid mock, /alerts loaded with every `/_next/static/chunks/*` request aborted shows the server-rendered header, the delivery line and the tabs, on both origin/final's `app/alerts/page.tsx` and the new one. So the blank was not reproduced, and the earlier cause ("Suspense bails out with no fallback") was wrong: the `BAILOUT_TO_CLIENT_SIDE_RENDERING` marker comes from the `ssr: false` LazyHosts on every page (`.next/server/app/pricing.html` has it too). Shipped anyway: a `PageSkeleton` fallback on the page's Suspense, and "Loading your alerts…" until the account's data has loaded (`repoReady`, 8 s cap) instead of flashing "No alert rules yet". Regression check: `e2e-paid/qa-c2-alerts.spec.ts` (header, delivery line and loading line visible with client chunks blocked). Q: if Marc still sees a blank /alerts on kismetodds.com, note browser, plan and the console error; a client error after hydration is the remaining suspect. |
| 23/64 say plainly how alerts are delivered | Fixed, verified in mock | /alerts header: "While Kismet is open in a tab, rules check every 2 minutes and alerts land in the bell (and as browser notifications if you allow them)." Paid plans add: "With email on, our servers also check once a day, even when Kismet is closed, and email you what's new. Anything already in your bell isn't emailed again." Editor rows: Browser notification "While Kismet is open in a tab"; Email "Checked once a day, even when Kismet is closed". Rule line names its channels ("inbox + browser + email"). |
| 64 email alerts for Pro | Shipped (code + tests); **not verified live** | Editor has an Email switch for Pro/Premium (hidden in demo and on Free); new rules start with email on; each switch changes only its own channel. Mock e2e: Pro creates a rule, the switch is on, `/api/data` returns `channels: ["email"]`. Unit, `test/alerts-email.test.ts` (Resend's HTTP API stubbed, real `sendEmail`): Pro → one POST to api.resend.com with `List-Unsubscribe` + one-click header, the disclaimer, "pays 1.39x", no cents, event `sent_channels` `["in_app","email"]`; Free → no request; no `RESEND_API_KEY` → nothing sent and email not claimed; no `UNSUBSCRIBE_SECRET` → no send, counted as an error; Resend 422 → error, not claimed; an alert the open tab already inserted (same dedupe key) → not emailed. |
| 64 cron route | Checked | `vercel.json` crons: `/api/alerts/run` at `0 13 * * *`. Auth: `curl -s -o /dev/null -w "%{http_code}" https://kismetodds.com/api/alerts/run` → `401` (CRON_SECRET bearer required, `lib/cron.ts`). Stale "every 5 min" comment in the route fixed. Schedule left daily on purpose (a sub-daily cron fails a Hobby deploy, and `final` deploys production). |
| 64 Telegram / Discord | Removed from sale | Not shippable tonight: the editor can't store a webhook URL, and Telegram needs a bot token + chat_id in the URL. /pricing compare row Premium: "Same as Pro, 100 rules"; Premium card: "100 alert rules". Server webhook code left in place, dormant (no rule can carry a webhook). docs/01 tier table updated. Mock e2e: /pricing HTML has no "Telegram" or "Discord". |
| unsubscribe page pointer | Fixed | Invalid-link page said "Settings → Alerts" (doesn't exist); now "the Alerts page in Kismet". |

Changed /pricing lines (for main's merge with lanes B, C, D): `app/pricing/page.tsx` compare row `["Alerts", …]` only;
`components/pricing/Plans.tsx` Pro card string "Alerts by email (checked once a day) and in the browser while Kismet is
open, 20 rules" and Premium card string "100 alert rules" (substring edits, no reflow).

No migration: `alert_rules.channels` is `text[]`, user-writable under own-row RLS, schema allows `email`.

### Needs Q / main to verify (production)
1. Vercel env (Production) has `RESEND_API_KEY`, `EMAIL_FROM` (a verified Resend sender), `UNSUBSCRIBE_SECRET`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`; admin setting "alerts enabled" is on. Without the first three, rules still fire to the bell but no email goes out (and the run logs errors).
2. After the first 13:00 UTC run following deploy, `/admin/health` "Alerts" last run shows `emails` above 0 for a Pro test account with an email rule (or run `curl -H "Authorization: Bearer $CRON_SECRET" https://kismetodds.com/api/alerts/run` once and read `emails`).
3. Existing rules have no email channel (the editor never saved it). Not backfilled; Q decides whether to.
4. Only once a day is honest today. For faster email (for example after each 30-minute scan), options: Vercel Pro and a sub-daily cron in vercel.json, or a step in `.github/workflows/refresh.yml` that POSTs `/api/alerts/run` with a `CRON_SECRET` Actions secret (scheduled runs use the default branch's copy). Either way, change the "once a day" copy (/alerts, /pricing) with it.
5. Not in scope, noted: Free users can open /alerts and the editor; creating a rule fails at the plan quota (0 rules on Free) with no upgrade message.

## QA-C2 2: #38, #58, #72 AI connector allowance (branch claude/qa-c2-connector, stacked on claude/qa-c2-alerts)

What the code enforces (`lib/abuse.ts` RULES, `lib/mcp/server.ts` gate): Free none; Pro 3 tool calls per rolling 24 h
(`mcp_pro_daily`); Premium no daily cap, 60 calls a minute (`mcp_premium`). The rate limiter never fails open (Upstash
down → the same limits per instance). Before: compare table "3 calls a day" / "Yes"; Pro card silent; Premium card
"(read-only connector)"; /account "up to 60 calls a minute" / "Premium has no daily cap"; consent page and llms.txt
each worded it their own way.

| Item | Status | Evidence |
|---|---|---|
| 38/58/72 one statement everywhere | Fixed, verified in mock + unit | New `lib/connector-plan.ts` (client-safe) holds the numbers and the words; `lib/abuse.ts` RULES read the same constants, so copy and limits can't drift. Statement: **Pro: 3 calls a day. Premium: no daily cap (up to 60 calls a minute). Not on Free.** Compare table: Pro "3 calls a day", Premium "No daily cap (up to 60 calls a minute)". Pro card (new line) "Use Kismet in Claude, ChatGPT and Cursor: 3 calls a day"; Premium card "Use Kismet in Claude, ChatGPT and Cursor: no daily cap (up to 60 calls a minute)". /account: "Your Pro plan: 3 calls a day. Premium: no daily cap (up to 60 calls a minute)." / "Your Premium plan: no daily cap (up to 60 calls a minute)." / Free "Not on Free. Pro: … Premium: …". OAuth consent page, llms.txt and the connector's Free refusal / Pro used-up messages use the same line. `test/connector-plan.test.ts` (RULES = constants, /account per plan, and a source scan: no page words the allowance by hand); `e2e-paid/qa-c2-alerts.spec.ts` checks /pricing's table and cards. |

Changed /pricing lines: `app/pricing/page.tsx` the connector compare row only (plus a one-line `up()` helper above
`rows`); `components/pricing/Plans.tsx` one string added to the Pro card points (after the alerts string) and the
Premium card's first connector string replaced. `components/account/McpSetup.tsx` plan paragraph.
