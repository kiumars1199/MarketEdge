# Final screenshots (Lane U, docs/17)

Every page at 390 px (phone) and 1440 px (desktop). Full-page captures, except the drawer, which scrolls inside a fixed panel.
Taken on 2026-11-17 from a production build (`next build && next start`) with `DEMO_MODE=true DATA_SOURCE=local` and the real `output/` data.
The browser had reduced motion on.

How to retake them:

```bash
cd apps/web
DEMO_MODE=true DATA_SOURCE=local pnpm exec next build
DEMO_MODE=true DATA_SOURCE=local pnpm exec next start -p 3080
BASE=http://localhost:3080 OUT=../../docs/screenshots/final node scripts/screenshots.mjs
```

The script also reports problems on each page:
- console errors and warnings
- page errors
- horizontal scroll
- any `NaN`, `undefined`, `null` or `[object Object]` on screen

Results of the final run:
- no horizontal scroll at 390 px
- none of those values on screen
- no console errors and no CSP violations, apart from the 404 page's own 404 status

A note on the phone captures: the bottom navigation bar is fixed to the screen, so it shows partway down each full-page image. That comes from how the page is captured; on a phone the bar stays at the bottom.

| Page | Phone | Desktop |
|---|---|---|
| Best bets `/` | [390](home-390.png) | [1440](home-1440.png) |
| Best bets, signed out on Free (paid mock) | [390](free-home-390.png) | [1440](free-home-1440.png) |
| Market drawer `/?m=…` | [390](drawer-390.png) | [1440](drawer-1440.png) |
| All markets `/markets` | [390](markets-390.png) | [1440](markets-1440.png) |
| Event `/event/[id]` | [390](event-390.png) | [1440](event-1440.png) |
| Market page `/m/[id]` | [390](market-390.png) | [1440](market-1440.png) |
| How it works `/about` | [390](about-390.png) | [1440](about-1440.png) |
| Plans `/pricing` | [390](pricing-390.png) | [1440](pricing-1440.png) |
| Plans, signed out (paid mock) | [390](free-pricing-390.png) | [1440](free-pricing-1440.png) |
| Sign in `/login` | [390](login-390.png) | [1440](login-1440.png) |
| Onboarding `/onboarding` | [390](onboarding-390.png) | [1440](onboarding-1440.png) |
| Account `/account` | [390](account-390.png) | [1440](account-1440.png) |
| My list `/watchlist` | [390](watchlist-390.png) | [1440](watchlist-1440.png) |
| My bets `/journal` | [390](journal-390.png) | [1440](journal-1440.png) |
| Alerts `/alerts` | [390](alerts-390.png) | [1440](alerts-1440.png) |
| Dashboards `/dashboards` | [390](dashboards-390.png) | [1440](dashboards-1440.png) |
| Settings `/settings` | [390](settings-390.png) | [1440](settings-1440.png) |
| Calculators `/tools` | [390](tools-390.png) | [1440](tools-1440.png) |
| Results `/track-record` | [390](track-record-390.png) | [1440](track-record-1440.png) |
| Status `/status` | [390](status-390.png) | [1440](status-1440.png) |
| Terms `/terms` | [390](terms-390.png) | [1440](terms-1440.png) |
| Privacy `/privacy` | [390](privacy-390.png) | [1440](privacy-1440.png) |
| Refunds `/refunds` | [390](refunds-390.png) | [1440](refunds-1440.png) |
| Disclaimer `/disclaimer` | [390](disclaimer-390.png) | [1440](disclaimer-1440.png) |
| Contact `/contact` | [390](contact-390.png) | [1440](contact-1440.png) |
| Not found (404) | [390](404-390.png) | [1440](404-1440.png) |
| Connect the extension `/ext/connect` | [390](ext-connect-390.png) | [1440](ext-connect-1440.png) |

The signed-out Free captures used the `playwright.paid.config.ts` environment on `next dev`, with `DEMO_MODE=false`, `E2E_MOCK=1` and the mock Supabase and Stripe. That is why the Next dev badge appears in them.

There is no capture of the 500 page. No route can be made to throw on demand, so `app/error.tsx` was checked in code instead: it has a heading, a "Try again" button and a link back to Best bets, and the footer disclaimer still shows.

## Lighthouse (mobile)

Version: `npx lighthouse@13.6.0 <url> --form-factor=mobile`, run against `next start` on this demo build, three runs per page. The table shows the median.

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/` | 99 (range 94–99) | 100 | 96 | 91 |
| `/about` | 99 | 100 | 96 | 91 |
| `/pricing` | 99 | 100 | 96 | 91 |

What still keeps scores below 100:
- **SEO 91: meta description.** Next 15 streams metadata into `<body>` for ordinary browsers. Crawlers on Next's bot list get it in `<head>`, and some runs scored 100.
  Forcing `htmlLimitedBots: /.*/` moved metadata into `<head>`, but it also delayed the first paint, and home performance dropped to 84. So it was not kept.
- **Best practices 96: one Chrome "Issues" panel entry about the content security policy, with no detail.** The console shows no CSP violations. The nonce plus `strict-dynamic` CSP is unchanged.

## axe

`e2e/a11y.spec.ts` runs `@axe-core/playwright` 4.14.0 with the WCAG 2.0 and 2.1 A and AA rules. It covers every page above, plus `/event/[id]`, `/m/[id]` and the open drawer, and it also checks that the footer disclaimer is present.

Result: **0 serious or critical violations on all 23 checks**. It runs as part of `PW_PORT=3180 pnpm e2e`.

## Admin (Lane AD)

`admin-*.png` (overview, users, user, settings, health, audit) come from the paid-mode dev server with the in-app
Supabase/Stripe mock (`playwright.paid.config.ts`, `ADMIN_EMAILS=admin-e2e@example.com`), signed in as that admin, with
three mock users and one comp. Not a production build; the fixture data is 22 h old, so the header shows it as stale.
