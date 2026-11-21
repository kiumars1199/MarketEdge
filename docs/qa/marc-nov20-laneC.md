# Marc's QA list (Nov 20, 2026): lane C log

Lane C items: 18, 48 (cancel), 32, 30, 17, 73, 33, 9, 19, 53, 21, 22, 23, 64, 38, 58, 72, 39.
Branches are stacked (each one starts from the previous), so they merge in order. "Verified live" means checked on
kismetodds.com; "verified in mock" means the paid e2e mock (DEMO_MODE=false, app/e2e-mock Supabase + Stripe).

Baseline: on origin/final (67faeaf) `test/teaser.test.ts` "one bet per game" already fails (3 vs 4) before any lane C
change. It depends on the fixture date, not on these files; left for its owner.

## QA-C 1: #18, #48 (cancel part)

| Item | Status | Evidence |
|---|---|---|
| 18 /account: plan, renewal or trial-end date, Manage billing or cancel | Done (in code since #4), verified in mock | `e2e-paid/qa-c-billing.spec.ts`: after a Premium trial checkout /account shows "Premium", "Free trial", "Trial ends <Month D, YYYY>", the `manage-billing` button "Manage billing or cancel", and the button gets a portal URL (200). |
| 18 live portal | **Not verified live; Q checks** | Production's price IDs (`STRIPE_PRICE_*` in Vercel, `price_1UdRkcHpG4ZG7Gys…`) belong to a Stripe account the Stripe connector can't see: on the account it can see (Kismetodds, live mode) they are "No such price". That live account has no Customer Portal configuration and no subscriptions. Q: in the account production uses, open Dashboard → Settings → Billing → Customer portal, turn on "Cancel subscriptions" (and plan switching) and save once; without a saved portal configuration Stripe refuses portal sessions and the button shows "Couldn't open billing. Try again." No Stripe writes made. |
| 48 Terms points to the cancel button | Fixed | Terms: "open your account page and choose **Manage billing or cancel** (Stripe's billing page)". Refunds used "Manage billing"; it now uses the button's exact label. Same e2e checks both pages' HTML. |
| 48 FAQ wording | Left to lane B | Lane B owns FAQ copy. /pricing FAQ says "Cancel from your account page", which is right but doesn't name the button. |

## QA-C 1 (also): #32, #30

| Item | Status | Evidence |
|---|---|---|
| 30 Free "Start free" → sign-up | Verified live | `curl https://kismetodds.com/pricing` and `/`: `data-testid="start-free" href="/signup"`. |
| 32 Start trial keeps plan, period and trial through sign-up and lands in checkout | Verified live (links) + in mock (whole flow) | Live hrefs: `/signup?next=%2Fpricing%3Fstart%3Dpro_monthly` and `premium_monthly`. Mock e2e: Yearly toggle → Premium "Start trial" → `/signup?next=…premium_yearly` → magic link → `/onboarding?next=…premium_yearly` → Skip → checkout opens by itself → `/account?checkout=success` → Premium on a trial. |

## QA-C 2: #33 (branch claude/qa-c-404)

| Item | Status | Evidence |
|---|---|---|
| 33 unknown URL signed out → 404 page, not /signup | Fixed, verified in mock | Before (live): `curl -I https://kismetodds.com/nope-xyz` → 307 to `/signup?next=%2Fnope-xyz`. Now `lib/auth/public-paths.ts` lists the app pages (`APP_PAGES`); only those go to sign-up, any other path falls through to Next's 404 page. Fails closed: `test/account-wall.test.ts` reads `app/` and fails if a page folder is in no list. `e2e-paid/qa-c-404.spec.ts`: `/nope-xyz`, `/pricingx`, `/some/deep/path` → 404 with the 404 page, header and disclaimer; `/bets`, `/account`, `/kalshi` still → `/signup?next=…`. |

Note: `e2e-paid/admin.spec.ts` "normal user and anonymous visitor" failed twice here, at the **signed-in** non-tester check
`/api/combos/kalshi → enabled false` (line 47), which this change doesn't touch (signedOutAccess only runs with no
session). The signed-out part (`/combos`, `/kalshi` → sign-up) passes in qa-c-404.spec.ts. Flagged to main.

## QA-C 3: #17, #73 (branch claude/qa-c-header)

| Item | Status | Evidence |
|---|---|---|
| 17/73 signed-in header the same on every page (Combos, Kalshi, Account, Admin for admins, Updated clock), /kalshi and 404 included | Fixed, verified in mock | Cause: the header was signed out in the server HTML and filled in Account, Admin and the beta links only when `/api/me` answered, so pages looked different while loading, and at 1280 px the nav overflowed (Kalshi clipped, search squashed). Now the root layout passes a server hint (`getMe`, React `cache()`d) to Header, MobileNav and AccountLink; the gated links come from `lib/beta.ts navFeatures` on the server (the Kalshi rule reads a server-only env var, so the browser can't decide it); beta pill is a dot below 2xl; the Updated pill holds its space while loading. Measured at 1280 px: nav 591/591 on /bets, /kalshi, /nope-xyz and after a soft navigation. `e2e-paid/qa-c-header.spec.ts`: admin sees Combos, Kalshi, Admin, Account in the first HTML of /bets, /kalshi, /pricing, and on /nope-xyz and /kalshi with `/api/me` blocked; a normal user sees Account, no Admin or beta links. Fails on the old layout. |

Note: the 404 page's body (header included) streams from the RSC payload, not the first HTML, in production too
(`curl https://kismetodds.com/nope-xyz` has no `<header>`); that is Next's not-found rendering, unchanged here. With the
hint it renders signed in at once instead of after `/api/me`.

Gates: tsc, lint OK; vitest 1081/1082 (only the known teaser test); `check:js` landing 149.6 kB (budget 150); demo e2e
s1-landing, s6, s6-tools, t291-ui, headers 13/13; paid qa-c-header 2/2. Paid `admin.spec.ts` timed out here on dev compiles
(shared container); main's run passes.

## QA-C 4: #9 (branch claude/qa-c-upsell)

| Item | Status | Evidence |
|---|---|---|
| 9 Pro upsell modal: close button, Escape, click outside | Fixed, verified in mock | The only upgrade pitch shown in a modal is the "More filters" sheet for Free users: most of it is blurred behind "Upgrade to unlock" (`UpgradeGate`, unchanged), and its only way out was a green "Done" that read as "apply", not "close". The sheet now also has a ✕ ("Close filters"). Escape and backdrop click already came from the native `<dialog>`; now tested. `e2e-paid/qa-c-upsell.spec.ts` (Free user, 1280 px): on /bets and /markets the sheet shows the Pro pitch and closes with ✕, Escape and a click outside. |
| 9 loading state on filter change | /bets already done (#45 "Updating bets…"); /markets fixed | /markets showed bare skeleton rows with no words. It now also shows "Loading markets…" (`role="status"`). The same e2e delays `/api/markets` 2.5 s, taps "Confident" and sees the status, then sees it go. |

Gates: tsc, lint OK; vitest 1087/1088 (known teaser test); `check:js` 149.6 kB; demo e2e s2-filters, overhaul-cards 10/10;
paid qa-c-upsell 1/1.

## QA-C 5: #19, #53 (branch claude/qa-c-views)

| Item | Status | Evidence |
|---|---|---|
| 19 saved views list (apply, rename, delete) reachable from /bets and /markets | Fixed, verified in demo build | Before: /bets could only save a view (no way to see or use it there); /markets had the preset chips, with rename/delete hidden behind making a view active and opening its ⋯ menu. Now a "Saved views" button sits next to "+ Save this view" on both pages and opens one list: tap a name to apply it, Rename in place, Delete (asks once more). The list loads on the first tap (`next/dynamic`), so the pages' first JS doesn't grow. |
| 53 save dialog pre-fills a name | Fixed | `lib/presets-name.ts suggestViewName`: up to three plain parts from the filters that are on (topic, payout, chance to win, closing window, Live, Confident, …), e.g. "NFL · 70%+ to win"; "My view" with none. Used by the dialog on /bets, /markets ("+ Save this view" and PresetBar's Save) and by the filter sheet's "Save as preset". `test/presets-name.test.ts` (4); `e2e/qa-c-views.spec.ts`: "My view" on a clean /bets, a filtered name on /markets, then apply from /bets, rename and delete from /markets. |

Gates: tsc, lint OK; vitest 1091/1092 (known teaser test); `check:js` 149.7 kB (+0.1); demo e2e qa-c-views, s4-presets,
s2-filters 3/3.

## QA-C 6: #21, #22 (branch claude/qa-c-settings)

| Item | Status | Evidence |
|---|---|---|
| 21 /settings linked from /account (and the account menu) | Fixed, verified in mock | Signed in, /account had no way to Settings (the link existed only when accounts are off). It now has a "Settings" button at the top, and /settings has "Plan and billing" back to /account. On phones the More sheet already lists Settings. The desktop header has no account *menu* (Account is a plain link, and at 1280 px the header has no room for another item); **Q decides** whether Account should become a menu. |
| 22 settings and journal sync to the account | Already true in code; copy fixed; verified in mock | Signed in, profile (settings), saved views, My list, My bets and alerts go through `SupabaseRepo` → `/api/data` (Supabase, RLS as the user). But /settings said "Saved in this browser… Nothing is sent to a server", /journal "Stored on this device only", and the log-a-bet form "Saved on this device only". Now one module (`lib/saved-where.ts`) says "Saved to your account" when accounts are on, and keeps the local wording in demo mode. "Clear local data" (it cleared only this browser, not the account) is replaced by a pointer to Account, where deleting the account deletes the data. e2e: a setting changed on one device shows on a second one signed in as the same user. No migration needed. |
| 22 onboarding banner hides once onboarding is done or dismissed | Fixed, verified in mock | It rendered on the server before the profile loaded, so it flashed for everyone who had finished setup; its dismissal was kept only in this browser. Now it waits for the account's profile (`useRepoReady`), and dismissing it saves `onboarded_at` to the account (as /onboarding's "Skip setup" does). e2e: not in the first HTML for an onboarded user, never visible while `/api/data` is slow; dismissed on one device, gone on a second. |

Gates: tsc, lint OK; paid e2e qa-c-settings 2/2, s7-upgrade, overhaul-funnel pass (7/7 with these).

## QA-C 7: #39 (branch claude/qa-c-pricing)

Stacked on claude/qa-d-golive (e25342d: Combos and Kalshi live), with claude/qa-c2-connector (a335f8e: alerts and the connector allowance) and claude/qa-c-settings (c965d9c) merged in.

| Item | Status | Evidence |
|---|---|---|
| 39 plan cards and compare table list only shipped features | Fixed | The only unshipped feature still sold was the Chrome extension: Premium card "Chrome extension: estimated return right on Polymarket (coming soon)" and the /pricing compare row "Chrome extension / — / — / Coming soon". Both are removed until it ships (**Q**: put it back at launch). Combos/Kalshi lines (lane D), alert strings and the connector rows (lane C2, built from `connectorAllowance`) are unchanged. Kept: the "Coming soon" plan button when billing is off (a real state) and the Chrome Web Store note on /ext/connect. `components/pricing/Plans.test.tsx`: no plan-card item says coming soon or names the extension; the compare table has no such row. |

Gates: tsc, lint OK; vitest 1105/1106 (known teaser test; c2's connector source scan passes); `check:js` 141.6 kB; demo e2e s1-landing 3/3; paid e2e t291-plans passes (it timed out twice on the /signup click while the shared dev server was compiling, then passed on the rebuilt branch).
