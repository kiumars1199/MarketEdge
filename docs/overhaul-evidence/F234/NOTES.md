# F2–F4 evidence: stale alarm, funnel, lifecycle emails

Branch `worktree-agent-aed0561c2651fdc20`, which branches from `overhaul`. The commits are:

- T-298 `b8caec4`
- T-299 `51ea927`
- T-300 `f855a47`, then the follow-up fixes after review (see the final commit)

Nothing was pushed, and nothing was written to live Resend, PostHog, Supabase, Stripe or Vercel. Every Resend and fetch call in the tests is a mock.

## Gates (run after T-300)

```
pnpm lint       → eslint . --max-warnings 0      (clean)
pnpm typecheck  → tsc --noEmit                   (clean)
pnpm test       → Test Files 94 passed (94), Tests 694 passed (694); ops node tests: tests 36, pass 36, fail 0
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_PORT=3240 pnpm exec playwright test e2e-paid/overhaul-funnel.spec.ts -c playwright.paid.config.ts --workers=1
                → 2 passed (1.7m)   (rerun after the T-300 fixes: the webhook path now also does lifecycle mail)
e2e/s1-landing.spec.ts (demo regression after T-299) → 3 passed
```

## F2 stale-data alarm (T-298)

**Files**
- `ops/stale_alarm.mjs`
- `.github/workflows/stale-alarm.yml`
- `ops/tests/stale-alarm.test.mjs`

**Schedule and trigger**
- Runs every 15 min (`7,22,37,52 * * * *`), and can also be started by hand.
- Each run reads `https://kismetodds.com/api/meta`.
- It counts an incident when `scanned_at` is more than 45 min old, or when the site errors: non-2xx, network failure or timeout, or a missing, NaN or future `scanned_at`.
- An error is retried 3 times within the run, 10 s apart, before it counts.
- The alert goes to kismetodds@gmail.com through Resend.

**Why raw meta age, not "age minus the Free delay"**
- Anonymous `/api/meta` serves the newest scan that is at least 15 min old (`getStoreFor`, lib/data/store.ts).
- While the engine is healthy that is 15–32 min with Railway every 15 min. The refresh.yml fallback can reach about 45.
- Once the engine has stalled for more than 15 min, the newest scan is older than the delay, so meta age equals live age.
- So "meta age > 45 min" means "live scan > 45 min old". Subtracting the delay would push the alarm out by 15 min.

**Why a GitHub Action, not Railway**
- Railway runs the engine (`railway.json` → `ops/scheduler.py`).
- A watchdog there would go down with the thing it watches.

**Incident state**
- State is kept in the Actions cache: restore with `restore-keys: stale-alarm-`, save under a unique key per run, with `if: always()`. refresh.yml uses the same pattern.
- A state branch would add a commit every 15 min.
- Supabase would make the alarm depend on the app's own database, which may be the thing that is down.
- State is written only after Resend answers 2xx. A failed send fails the run, and the next run retries.
- One incident gives one alert and one all-clear. A switch from stale to down and back to stale is still one incident.

**Tests** (`node --test ops/tests/stale-alarm.test.mjs`)
```
ok 1 - a stale timestamp across several consecutive runs sends exactly one alert, recovery exactly one all-clear
ok 2 - 45 min exactly is fine; 46 is stale
ok 3 - site error path: HTTP 500 / network failure over consecutive runs is one alert, recovery one all-clear
ok 4 - stale → site down → stale is still one incident (one alert, one all-clear)
ok 5 - errors are retried within a run before they count: a cold start that answers on the 2nd try is not an incident
ok 6 - missing, NaN or future scanned_at is an error, never healthy
ok 7 - Resend failing: state is not advanced, the run fails, and the next run delivers the one alert
ok 8 - no Resend key: an incident fails the run loudly and keeps state; a healthy site needs no key
ok 9 - decide() is a pure state machine
```

**Limits**
- GitHub disables scheduled workflows after 60 days with no commits to the repo.
- Schedules run from the default branch's copy of the workflow, so the alarm starts only after this is merged there.

## F3 funnel (T-299)

**Steps**
- Signed out: `landing_view`, `signup_start`, `upgrade_view`.
- Signed in, once per account: `signup_done`, `first_bets_view`, `first_bet_click`, `checkout_start`, `trial_start`, `paid`.
- `upgrade_view` counts once signed out (per visit) and once per account signed in.

**Where steps are recorded**
- Server-only steps are recorded by the hooks in `lib/email/lifecycle.ts`:
  - `signup_done`: first sign-in of an account created in the last day.
  - `trial_start`: a trialing `customer.subscription.created`.
  - `paid`: the first `invoice.paid` with an amount above zero.
- `/api/funnel` accepts only client steps and refuses server steps with 400.

**Storage: Supabase `funnel_events`, not the PostHog API**
- The table is `funnel_events` with `unique(user_id, event)`. "First" steps are deduplicated per user by the database, across devices.
- PostHog in this app runs memory-only with no person profiles. The consent rules in `lib/telemetry.ts` keep it that way, so PostHog cannot answer "once per user".
- The server sends PostHog a capture only for a newly inserted row. Each capture has a random distinct_id and `$process_person_profile: false`, and is sent only when `NEXT_PUBLIC_POSTHOG_KEY` is set.
- The client sends nothing in demo mode.

**Admin page** (`/admin/funnel`)
- Behind `requireAdmin`.
- Reads the `admin_funnel(days)` RPC (security definer, service role only). It falls back to counting raw rows.
- Shows totals, step-to-step conversion and daily counts.
- The page notes that signed-out steps count visits and signed-in steps count people. Screenshot: `admin-funnel.png`.

**Tests**
- `lib/funnel.test.ts`: 12 tests.
- `test/funnel-db.test.ts`: 5 tests against PGlite, applying every migration.
- `e2e-paid/overhaul-funnel.spec.ts`: 2 tests.
  - The walk repeats every step that could fire twice: reloads, a second click, a Stripe retry of the paying invoice, a renewal.
  - It asserts each user step appears exactly once.
  - It asserts each signed-out step went up by exactly 1.
  - It asserts that forging `paid` from the browser gets a 400.

**Dependencies**
- `components/trade/VenueButton.tsx` fires `first_bet_click`. Lane B places that button on cards; until then the e2e sends the same POST and records a "pending" annotation.
- `invoice.paid` must be enabled on the webhook. Rerunning `ops/stripe-setup.mjs` enables it, because the new `case` is picked up.

## F4 lifecycle emails (T-300)

| Email | Trigger | Dedupe ref | Unsubscribe |
|---|---|---|---|
| Welcome: how to read a card, 3 lines | first sign-in of a new account (`lib/auth/finish.ts` → `onFirstSignIn`) | `''` | **yes**: link + List-Unsubscribe (RFC 8058) |
| Trial ends in 2 days + how to cancel | daily Vercel cron `/api/lifecycle/run` (GET, `CRON_SECRET`, `41 15 * * *`): trialing, ending within 2.5 days and still in the future, not set to cancel | subscription id | no |
| Receipt | first `invoice.paid` with `amount_paid > 0` | `''` | no |
| Cancel confirmation | `customer.subscription.updated` turning `cancel_at_period_end` / `cancel_at` on, or `customer.subscription.deleted`; skipped when the user's row shows another subscription still paying (an old Pro ending after an upgrade to Premium) | subscription id | no |

**`invoice.paid` before the customer is linked**
- This happens with a no-trial checkout or a Payment Link, where the charge can arrive before the event that links the customer.
- `handleEvent` throws `RetryLater` when `amount_paid > 0` and no user is found. The webhook answers 500, the event is not marked seen, and Stripe retries.
- `applySubscription` already handles the same race this way.
- So neither the `paid` step nor the receipt is lost.
- `$0` invoices for unknown customers stay 200.

**Sending once**
- `lifecycle_emails` has primary key (user_id, kind, ref).
- The server claims a row before it sends.
- When the send throws or returns `sent:false` (Resend not configured), the claim is released so a later trigger can send.
- A duplicate is never sent.

**Unsubscribe policy**
- **Welcome** is optional relationship mail, so it gets the unsubscribe link.
  - The token is the existing account token, and it turns off alert emails, the only other optional mail.
  - The welcome itself goes out only once.
- **Receipt and cancel** are transactional under CAN-SPAM 16 CFR 316.3, so they have no unsubscribe.
  - They confirm a transaction the person agreed to, or a change they made.
- **Trial ending** is a required pre-renewal notice under card network rules and state automatic-renewal laws.
  - An opt-out would let someone switch off the warning the law wants them to get.
- Each of these emails states in its footer why it has no unsubscribe link.

**Limits**
- **Welcome is never retried.** `onFirstSignIn` runs only on the sign-in that stores the terms acceptance. If that send fails (Resend down, `UNSUBSCRIBE_SECRET` unset, migration not applied), the welcome is never sent. The claim is released, but nothing calls the hook again.
  - In the paid e2e (no `UNSUBSCRIBE_SECRET`), this shows up as a logged `[lifecycle] first sign-in hook failed: UNSUBSCRIBE_SECRET is not set`, and the sign-in still succeeds.
- **Receipt:** if Resend fails at the first charge, nothing is sent then.
  - The hook never throws, so Stripe does not retry the event.
  - The receipt goes out on the next charge.
- **Trial reminder:** retries on the next day's cron while the trial is still in its window.
  - It skips rows with `cancel_at_period_end`.
  - A cancel recorded only as a `cancel_at` date is not in the subscriptions row, so that user would still get the reminder ("you'll be charged").
- **Cancel:** a user who cancels, resumes and cancels again on the same subscription gets one confirmation.
- **Wording:** the trial email says "open your account, tap Manage billing and cancel there". The test pins that `/account` renders the `Manage billing` button (`components/auth/AccountActions.tsx` → `/api/stripe/portal`). The Stripe portal's own button labels are not named, since they can change.

**Tests** (`lib/email/lifecycle.test.ts`, 15 tests)
```
✓ the route list is the real app tree (sanity)
✓ each renders: subject, heading, disclaimer, plain wording; every link resolves to an app route on our site
✓ content: welcome explains a card in 3 lines; trial says when and how to cancel; receipt and cancel give the facts
✓ unsubscribe: the optional welcome has the link and List-Unsubscribe; trial, receipt and cancel notices have neither
✓ claims before sending; a failed send releases the claim so a later trigger delivers exactly one
✓ Resend not configured ({ sent: false }): releases the claim, nothing recorded as sent
✓ welcome: first sign-in of a new account, once (two devices, two sign-ins); not for an old account
✓ welcome: a sign-in never fails because email did (Resend down, claim table missing)
✓ receipt: the first invoice with money only; Stripe retries and renewals send nothing more
✓ receipt: a failed send leaves no claim, so the next qualifying invoice event sends it, once
✓ cancel: when cancel_at_period_end turns on, then not again when the subscription ends at period end
✓ cancel: also a cancel_at date set in the portal, and an immediate end
✓ due: trialing, ends within 2.5 days and later than now, not already canceling
✓ sends each trial's reminder once across daily runs, retries after a failure, and a new trial gets its own
✓ GET /api/lifecycle/run needs the cron secret; with it and no Supabase it answers ran:false
```
- The route list comes from walking `apps/web/app/**/page.tsx|route.ts`. Route groups are dropped, and dynamic segments match any value.
- The root 404 catch-all and the e2e mock are left out, so a link to a missing page fails the test.
- Also in the same file:
  - upgrade vs cancel: 2 tests.
  - `invoice.paid` before linking: 1 test, through `handleWebhook`.
- Prices and plans are unchanged. Emails name the plan and the amount Stripe charged.

## Edits outside the files this lane owns (minimal, listed)

- `apps/web/instrumentation-client.ts`: calls `watchFunnelPaths()`.
- `apps/web/components/trade/VenueButton.tsx`: `funnel("first_bet_click")` in onClick, plus the import.
- `apps/web/lib/auth/public-paths.ts`: adds `/api/funnel` and `/api/lifecycle/run` (CRON_SECRET).
- `apps/web/lib/auth/finish.ts`: `await onFirstSignIn(user)` after the terms are saved.
- `apps/web/lib/billing/stripe.ts`:
  - A `case "invoice.paid"` that throws `RetryLater` for a charge to an unlinked customer.
  - `await afterBillingEvent(event, db)` before markSeen.
- `apps/web/components/admin/Controls.tsx`: a Funnel entry in SECTIONS.
- `apps/web/lib/email/index.ts` and `templates.ts`: optional `unsubscribeUrl`, and `layout` is exported (`lib/email/*` is owned).
- `apps/web/vercel.json`: the third cron, `/api/lifecycle/run`.
- New files outside the owned globs:
  - `apps/web/app/api/funnel/route.ts`
  - `apps/web/app/api/lifecycle/run/route.ts`
  - `apps/web/lib/funnel.ts` (+ `funnel.test.ts`)
  - `apps/web/lib/funnel-server.ts`
  - `apps/web/test/funnel-db.test.ts`
  - `apps/web/e2e-paid/overhaul-funnel.spec.ts`
- Tests that pin lists:
  - `test/rls.test.ts`: the new tables and `admin_funnel`.
  - `test/security.test.ts`: `us.i.posthog.com`.
  - `test/cron.test.ts`: the third cron route.
  - `ops/tests/stripe-setup.test.mjs`: `invoice.paid`.

## What the owner sets

**GitHub**
- Secrets: `RESEND_API_KEY` and `ALARM_EMAIL_FROM` (a verified Resend sender).
- Optional vars: `ALARM_EMAIL_TO` (default kismetodds@gmail.com) and `SITE_URL` (default https://kismetodds.com).
- Merge to the default branch so the schedule runs.

**Vercel**
- `RESEND_API_KEY`, `EMAIL_FROM`, `UNSUBSCRIBE_SECRET`, `CRON_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` (existing).
- Optional: `NEXT_PUBLIC_POSTHOG_KEY`.
- Vercel Hobby runs crons once a day, which is enough here.
- **Deploy risk:** `vercel.json` now has 3 crons. If the plan allows only 2, the deploy fails. The fallback is to drop that entry and call `runTrialReminders` from an existing daily cron route, such as `/api/settle/run`.

**Supabase**
- Apply `supabase/migrations/20261120000200_funnel_events.sql` and `20261120000300_lifecycle_emails.sql`.
- Until then, the funnel records nothing and lifecycle mail sends nothing. There are no errors to users and never a duplicate.

**Stripe**
- Rerun `node ops/stripe-setup.mjs` so the webhook subscribes to `invoice.paid`.
