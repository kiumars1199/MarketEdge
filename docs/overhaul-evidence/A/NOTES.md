# Lane A evidence: first screen and landing page (T-301)

## Headlines (docs/research/overhaul.md, R1-1, R1-2, R1-3, R1-7)
- **Shipped:** "Which Polymarket bets are worth it today?" Under it: "Placing a bet or two? Kismet shows which Polymarket bets look like good value today, how often bets like them win, and what $10 pays." Then one "Sign up free" button, with "10 bets a day, free. No card." under it (`FREE_BEST_BETS_A_DAY` = 10 in lib/entitlements.ts).
- Option 2: "Find the good-value bets on Polymarket." This is the research's fallback. It is clear, but it names neither the reader nor "today".
- Option 3: "Polymarket bets that pay more than they should." Rejected because it reads as a profit claim (R1-7).
- Not a user test: the research recommends a 5-person 5-second test before calling the choice settled.

## What changed
- Page order: hero (headline, sentence, button, one real BetCard) → 3 steps → 3 more real bets → plans (the existing `Plans`, prices unchanged) → 5-question FAQ (the existing pricing `Faq`) → "See how we track results" → /track-record.
- Removed:
  - the market-says/won-before bars and "Bars use…"
  - the live count line
  - the blurred placeholders and the "see N bets" CTA
  - the proof section (test/live numbers, `ProofLine`, `Tiles`, the week chart)
  - the closing CTA band
  - "Less luck, more math."
- Bets: the Free gate's daily sample (key `landing`, the same rows a Free account gets), in Best bets order. `landingBets()` then:
  - puts bets on Polymarket US first (§G2)
  - keeps one bet per game
  - skips titles with banned words or big numbers ("Spread: …")
- If there aren't enough games, a second line from the same game fills the gap, so the page still gets 1 + 3 bets when it can.
- No cookies or headers: `requestZone()` and the scan-time line are gone. A unit test proves `Landing` calls neither `headers()` nor `cookies()`. That is not proof `/` renders statically. For lane C: `lib/data/store.ts` fetches with `cache: "no-store"`, so check that against static rendering of `/`.
- The hero glow stays inside its box. An earlier version made the page 20 px wider than a 390 px screen. The spec now asserts there is no sideways scroll.
- `app/page.tsx`: only the landing title and description strings changed.

## Checks
- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm test`: 696/697 pass. The one failure is the `api.test.ts` 15k-row timing test under shared CPU load. It passes when rerun alone (7/7).
- Demo `e2e/s1-landing.spec.ts` (PW_PORT=3261): 3 passed.
- Paid `paywall-pages.spec.ts` and `t291-plans.spec.ts`: 4 passed. paywall-pages was updated for the new landing.
- `e2e-paid/overhaul-landing.spec.ts` (PW_PORT=3260, chromium): **red, 3 of 3 fail**. The only failure is `pts` from today's BetCard (below). Every other assertion passes at both sizes:
  - no sideways scroll
  - no banned word in the landing's own text (DOM with bet cards removed, plus title and metas)
  - section order
  - 3 steps, 3 bets, 5 FAQs, the results link
  - exactly one primary button in `main` above the fold ("Sign up free", 56 px tall)
  - the hero card fits within 900 px at 1440×900 and starts above the phone tab bar at 390×844
- **Blocked on lane B:** the whole-page banned check finds `pts` in today's `BetCard` ("better price than usual (+6–9 pts)"), in both the server HTML and the hydrated DOM. It should pass once B's card merges. Nothing else on the page hits.

## Not lane A's (for the lead)
- The header "Sign up" button and the phone tab bar "Sign up" also show on the first screen. They belong to the shell, so the one-button check is scoped to `main`.
- The footer still prints "Kismet. Less luck, more math." So do `app/_brand.tsx` TAGLINE and the `app/opengraph-image.tsx` alt. The research drops this line (R1-7).
- With the fixtures, the cards say "Closed" because the fixture scan is days old. On real data they show the closing time.

## Screenshots (after; before ones are in docs/overhaul-evidence/before/home-*.png)
- docs/overhaul-evidence/A/home-390x844.png, home-390x844-full.png
- docs/overhaul-evidence/A/home-1440x900.png, home-1440x900-full.png
- Regenerate with `LANDING_SHOTS=1` on the overhaul-landing spec. These show today's card; re-shoot after B merges.
