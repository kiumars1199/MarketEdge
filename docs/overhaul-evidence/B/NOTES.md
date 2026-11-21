# Lane B evidence (T-302): cards, Best bets, filters

Screenshots of `/bets` on the demo fixtures (`DATA_DIR=test/fixtures DEMO_MODE=true`), production build, port 3250:
`shots/before-*` (before T-302) and `shots/after-*` at 390×844 and 1440×900, plus full-page captures. The HTML served
for `/bets` is in `before-bets.html` and `after-bets.html`. The cards read "Closed" because the fixture scan is
from Nov 16 and the screenshot clock is real time.

## What changed on the page
- Card face: seven slots (title, side and price, "Wins about N in 10", stars, "$10 wins $X", closing time, bet
  button). Everything else is in "Why this bet?", and its first line is "If it wins you get $X back ($10 + $Y)".
- §G1: a card with a Polymarket US quote shows the US price and return, "Polymarket US price, incl. its fee", and
  "Bet on Polymarket US" linking to `us.url`. A card with `us: null` shows a grey "International only, not on
  Polymarket US" label and no bet button. The international link sits inside "Why this bet?" with "Not available to
  US residents".
- §G2: "On Polymarket US" is on by default for every tier. The headline count, the list, the Free sample and the
  stars all come from the same set (`us.edge ≥ meta.rule.min_edge`), ranked by US return. Fixture: 34 of 151.
- One chip row: the top 6 sports with bets + "More sports", Today / This week, Safer / Balanced / Bigger payouts,
  "On Polymarket US", "More filters (n)", "+ Save this view". Everything else is in the sheet.
- Risk bands follow where Best bets actually sit (real scan: 740 of 1,070 win 85%+, 268 win 70–85%, 62 under 70%,
  1 at 40% or less): Safer = 85%+, Balanced = 70–85%, Bigger payouts = under 70% (the 40% floor stays on).
- A pressed chip hides its own applied-filter pill; a filter set in the sheet or a shared link keeps its pill. Time
  chips match the window's end within 15 minutes, so Today / This week stay pressed after a reload.
- "Today's top 5", then "More bets". Removed: stat tiles, price-check chips, Pays chips, "Show every bet", Big
  payouts, More bets with an edge, Combos row, closing-soon strip and results ticker.
- Free: one solid card with a lock and "Unlock N more bets" where the free list ends (no blur or fade).
- R2-6: a filter change keeps the current list on screen, dimmed, `aria-busy` and not clickable, until the new list
  arrives. A skeleton shows only on a first load with no data.
- Tap targets: chips, card title links, "Why this bet?", applied-filter pills, "+ Save this view", and every control
  in the sheet are 44px or taller. The bet button is 48px and full width on phones.

## Checks
- `pnpm lint && pnpm typecheck && pnpm test`: 98 files and 1027 tests pass.
- e2e (chromium, `--workers=1`, port 3257 because 3250 was taken by another process): overhaul-cards, s1, s2, s3, s4, s5, multipliers, proof, t291-ui, search,
  a11y and timezone: 68 passed. trading-paper, headers, alerts, s6 and s6-tools: 9 passed. Together that is every
  chromium spec. overhaul-iphone (another lane's spec) and the paid suite were not run.
- `test/card-render.test.tsx` renders the card for all 151 fixture best bets, both exact and Free-banded. It checks
  for no banned words, at most 7 slots, the $10 line and the payout line, and the venue rule.
