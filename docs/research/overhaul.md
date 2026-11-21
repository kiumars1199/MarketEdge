# Overhaul research: the 15 rules we follow (T-294)

Consolidated from `overhaul-r1.md` (conversion, value proposition, trust) and `overhaul-r2.md` (data for non-experts, usability).
Rules keep their research IDs so lane commits that cite `(R1-n)` / `(R2-n)` stay valid. Every source below was downloaded and read
on Nov 20, 2026 (curl + text extraction; WebFetch could not resolve hosts in the sandbox). Full reasoning, quotes and the
removed-claims table are in the two lane files.

## Chosen value proposition

- **Headline:** "Which Polymarket bets are worth it today?"
- **Sentence:** "Placing a bet or two? Kismet shows which Polymarket bets look like good value today, how often bets like them win, and what $10 pays."
- **Button:** "Sign up free", with "10 bets a day, free. No card." under it.
- Rejected headlines: "Find the good-value bets on Polymarket." (fallback), "Polymarket bets that pay more than they should." (reads as a profit claim, R1-7).
- Scoring: lead's and R1's judgment against stated 5-second criteria (what / who / next, benefit, no banned words, no outcome promise), not a user test. Run a real 5-person 5-second test before calling it settled.

## The 15 rules

### 1. (R1-1) The top half of the first screen says what Kismet is, who it's for and what to do next
- Sources: https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/ · https://www.nngroup.com/articles/scrolling-and-attention/ · https://www.smashingmagazine.com/2023/12/five-second-testing-case-study/
- Copy this: At 390×844, put these in the top ~420 px: headline, one sentence, button, and a one-line no-card note. The real bet card starts right below and peeks above the fold. Nothing else goes above the card: no live counter, no bars.

### 2. (R1-2) Use everyday words, lead with the benefit and keep the mechanism for later
- Sources: https://cxl.com/blog/value-proposition-examples-how-to-create/ · https://www.optimizely.com/field-notes/articles/10-best-ab-testing-examples
- Copy this: Say what the user gets ("which bets look like good value today, how often bets like them win, what $10 pays"). "How it works" goes in the 3 steps below the fold, in words like:

### 3. (R1-3) Use one primary button that says exactly what happens, with the no-risk facts right beside it
- Sources: https://www.nngroup.com/articles/get-started/ · https://www.optimizely.com/field-notes/articles/10-best-ab-testing-examples · https://cxl.com/blog/10-principles-of-effective-pricing-pages/
- Copy this: Keep "Sign up free", as §A requires. It is specific, unlike "Get started". Put the facts that remove the risk on the line under it. Any other action is a plain text link, never a second button.

### 4. (R1-4) Show a real bet before asking for anything, and ask for the upgrade where the free limit bites
- Sources: https://www.nngroup.com/articles/login-walls/ · https://www.nngroup.com/articles/reciprocity-principle/ · https://baymard.com/research-articles/delayed-account-creation
- Copy this: The hero shows one real bet card, fully readable while signed out. In the app, the upgrade prompt is the locked card from §B, placed where the free list ends, saying exactly what unlocks. No pop-up on arrival, no prompt before the first bet card.

### 5. (R1-5) Signup: Google first, then email on the same screen, with the fewest fields
- Sources: https://developers.google.com/identity/sign-in/case-studies/reddit · https://www.optimizely.com/field-notes/articles/10-best-ab-testing-examples · https://www.actionnetwork.com/subscribe
- Copy this: `/signup` already puts Google first when the provider is configured (`components/auth/LoginForm.tsx`). Keep that, and make sure Google is enabled in production. Under it, use one email field and one password field. "Email me a link instead" becomes a text link, not a tab. Keep the 18+/Terms checkbox: it is a compliance rule, not friction to cut.

### 6. (R1-6) Pricing: highlight one plan, show the key differences up top, answer fears next to the button and say what happens next
- Sources: https://speero.com/post/the-effects-of-highlighting-a-recommended-pricing-plan-original-research · https://cxl.com/blog/10-principles-of-effective-pricing-pages/ · https://www.smashingmagazine.com/2022/07/designing-better-pricing-page/
- Copy this: - Keep the plans and prices exactly as they are.

### 7. (R1-7) Describe what Kismet does, never what the bettor will win: no guarantees, no money-making and no "skill beats luck"
- Sources: https://www.asa.org.uk/advice-online/betting-and-gaming-tipsters.html · https://www.asa.org.uk/advice-online/gambling-betting-and-gaming-personal-financial-problems.html · https://www.asa.org.uk/static/b324a7dd-94d6-4fb2-979365d66acb2e36/b36f7133-8d64-4ec8-8b6690a54bcfe141/The-CAP-Code-Gambling.pdf · https://www.asa.org.uk/rulings/isiris-racing-services-a17-402463.html
- Copy this: - The landing page carries no performance numbers (§E owners' call), only one plain link to /track-record.

### 8. (R1-8) Use social proof only if it's real and about clarity, not winnings. Until then, the real bet card is the proof
- Sources: https://cxl.com/research-study/social-proof/ · https://www.nngroup.com/articles/social-proof-ux/ · https://www.asa.org.uk/advice-online/betting-and-gaming-tipsters.html
- Copy this: Kismet has no collected testimonials, so the landing page shows none. No user counts either: NN/g's risk above applies, and counts above 3 digits are banned on the landing page. Later, use real, permissioned quotes about understanding, with a photo and first name. For example, a quote about seeing what $10 pays before betting, never one about winnings.

### 9. (R2-1) Say the win chance as a natural frequency: "Wins about 7 in 10"
- Sources: https://en.wikipedia.org/wiki/Base_rate_fallacy · https://en.wikipedia.org/wiki/Gerd_Gigerenzer
- Copy this: "Wins about 7 in 10".

### 10. (R2-2) Show the money in dollars on a fixed stake, and say exactly what "wins" means
- Sources: https://robinhood.com/us/en/learn/articles/profit-vs-payout-event-contracts/ · https://robinhood.com/us/en/support/articles/how-event-contracts-work/ · https://robinhood.com/us/en/prediction-markets/tennis/events/ben-shelton-vs-rafael-jodar-group-stage-match-nov-19-2026/ · https://polymarket.com/sports/nba/nba-cha-atl-2026-11-20

### 11. (R2-3) Plain words on the card, everything else behind one "Why this bet?" tap
- Sources: https://www.nngroup.com/articles/progressive-disclosure/ · https://www.nngroup.com/articles/ten-usability-heuristics/ · https://www.nngroup.com/articles/vanguard-mobile-app/
- Copy this: - The card shows none of: "pts", "edge", "Estimated return", price-as-of, tier note, record pill.

### 12. (R2-4) A value rating needs a word next to it, and must say what it measures
- Sources: https://www.nngroup.com/articles/rating-scales/ · https://www.actionnetwork.com/nba/projections
- Copy this: `★★☆ Good value` with `aria-label="Value: 2 of 3 stars"`. "Why this bet?" says in one sentence why it got that many (rule below).

### 13. (R2-5) Few chips in one row, and make "More filters" impossible to miss Always show what's filtered: selected chips with ✕, a "12 bets · Soccer · Today" line, "More filters (2)" (merged R2-7).
- Sources: https://baymard.com/blog/horizontal-filtering-sorting-design · https://baymard.com/blog/how-to-design-applied-filters · https://www.nngroup.com/articles/ten-usability-heuristics/
- Copy this: see "Filter chip row" below. There are 3 chip groups plus "More filters". Style "More filters" as a chip with an icon and count,

### 14. (R2-6) Loading: nothing under 1 s, skeleton cards for 1–10 s, never flash the screen
- Sources: https://www.nngroup.com/articles/skeleton-screens/ · https://www.nngroup.com/articles/response-times-3-important-limits/ · https://www.nngroup.com/articles/progress-indicators/
- Copy this: - First load of `/bets`: 5 grey card shapes the size of real cards, only if the load takes over about 1 s.

### 15. (R2-8) Thumb-sized targets, bigger for the main button
- Sources: https://www.nngroup.com/articles/touch-target-size/
- Copy this: - Chips at least 44 px tall (1 cm is roughly 38–40 CSS px, and the repo already uses 44 px buttons per docs/17) with 8 px gaps.

## 5 pages to imitate (screenshots at 390×844 in `docs/research/screens/`)

| Page | What to copy | Screenshot |
|---|---|---|
| Polymarket trade sheet | Stake chips +$1/+$5/+$10; one money line. Note: its "To win" is the *total* payout; our "$10 wins $X" is profit, so "Why this bet?" states the total too | `screens/polymarket-trade.png` |
| Polymarket sports list | One sport chip row with counts, big tappable price buttons | `screens/polymarket-sports.png` |
| Polymarket game page | One big number per side | `screens/polymarket-game.png` |
| Robinhood event page | Plain one-line outcomes, price beside each, payout timing in plain words | `screens/robinhood-event.png` |
| Action Network projections | Grade with a word/colour, locked rows as solid rows with a lock icon | `screens/actionnetwork-projections.png` |

Kalshi's page returned a bot wall (`screens/kalshi-market-botwall.png`), so it's not a model page.
