# Overhaul research R2: data for non-experts, usability (T-294)

Sources checked Nov 20, 2026. **Every claim below comes from a page that was opened** (curl and text extraction, or
Playwright at 390×844). Claims that only appeared in search snippets, or whose page could not be opened, were removed. They are
listed at the end so nobody re-adds them by mistake. Lines marked *Kismet decision* or *our reasoning* are design choices, not research findings.

Read with `docs/OVERHAUL.md` §B and `docs/overhaul-contract.md` §Card. Rules are numbered R2-1…R2-8 so the lead
can fold them into the 15 in `docs/research/overhaul.md`.

---

## The 8 rules

### R2-1. Say the win chance as a natural frequency: "Wins about 7 in 10"
- **Why:** Gigerenzer and Hoffrage developed and tested "natural frequencies", a format that helps people make Bayesian
  inferences correctly without outside help. Studies show inferences follow Bayes' rule more closely when information
  comes as natural frequencies, for laypeople and experts alike. The Cochrane Collaboration recommends the format
  for health statistics, and graphical versions (icon arrays) also help.
  **Limit:** that evidence is about reasoning tasks (e.g. test results), not about stating one win chance, so for us
  it is a sensible default rather than a measured win.
- **Sources (opened):** [Wikipedia: Base rate fallacy, "Findings in psychology" (cites Gigerenzer & Hoffrage 1995; Cochrane)](https://en.wikipedia.org/wiki/Base_rate_fallacy) ·
  [Wikipedia: Gerd Gigerenzer](https://en.wikipedia.org/wiki/Gerd_Gigerenzer)
- **Kismet example:** "Wins about 7 in 10".
  - *Our reasoning:* keep the same denominator (10) on every card so cards compare at a glance. The papers that would
    back this (consistent and small denominators) sit on hosts still blocked (see end).
  - Today `lib/format.ts winsAbout()` switches to "1 in N" below 35%, so two cards can use different denominators.
  - **Recommendation:** add a card-only `winsInTen(p)` in `lib/card.ts`. Use "about 2 in 10" down to 1 in 10 and
    "less than 1 in 10" below that. Put the exact "1 in N" inside "Why this bet?".
  - Don't edit `winsAbout()`: it also feeds the drawer, CSV and MCP text, and no lane owns `lib/format.ts`.

### R2-2. Show the money in dollars on a fixed stake, and say exactly what "wins" means
- **Why:**
  - Robinhood's "Profit vs. payout" article says "a common point of confusion for new prediction market participants" is
    the difference between profit and payout. The payout is $1 per winning contract whatever you paid. Profit is that minus what you paid.
  - Polymarket's own trade sheet (screenshot `polymarket-trade.png`) leads with a big dollar amount, quick-add chips
    `+$1 +$5 +$10 +$100`, and one green line: **"To win $19.89"** for $10 at 50¢. That is the **total payout** ($10 ÷ ~50¢ ≈ 19.9 shares × $1), not profit.
  - Robinhood's event pages say "Get $1 for every contract you own if your prediction is correct" and give a payout
    timeline ("Usually within 1 hour of event resolution").
- **Sources (opened):** [Robinhood: profit vs payout](https://robinhood.com/us/en/learn/articles/profit-vs-payout-event-contracts/) ·
  [Robinhood: how event contracts work](https://robinhood.com/us/en/support/articles/how-event-contracts-work/) ·
  [Robinhood event page](https://robinhood.com/us/en/prediction-markets/tennis/events/ben-shelton-vs-rafael-jodar-group-stage-match-nov-19-2026/) ·
  [Polymarket NBA game, trade sheet](https://polymarket.com/sports/nba/nba-cha-atl-2026-11-20)
- **Kismet decision (lead, Nov 20):** "$10 wins $X" means **profit after the fee**. Example: "$10 wins $5.60", "$10 wins $9.89".
  - Use a fixed $10 on every card, not the user's default stake.
  - The first line inside "Why this bet?" states the total plainly: "If it wins you get $15.60 back ($10 + $5.60). If it loses, you lose the $10."
  - **Watch out:** Polymarket's "To win" means total payout. A user who taps through from "$10 wins $9.89" will see
    "To win $19.89" on Polymarket's sheet for the same bet. The "Why this bet?" line is what reconciles the two, so it must name the total.
    Never use the phrase "To win" on our card.
  - Today's card says "Bet $100 → get $158 after fees if it wins" (total). Lane B changes it to the profit wording.

### R2-3. Plain words on the card, everything else behind one "Why this bet?" tap
- **Why:**
  - NN/G: "Progressive disclosure defers advanced or rarely used features to a secondary screen, making applications
    easier to learn and less error-prone." It improves learnability, efficiency of use and error rate.
  - "It's rarely a good idea to offer multiple ways to progress to secondary options."
  - Heuristic #2: "speak the users' language… rather than internal jargon."
  - NN/G's Vanguard case: balances (the top task) show on opening the app, and holdings sit behind a tap.
- **Sources (opened):** [NN/G progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) ·
  [NN/G 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) ·
  [NN/G Vanguard mobile app](https://www.nngroup.com/articles/vanguard-mobile-app/)
- **Kismet example:**
  - The card shows none of: "pts", "edge", "Estimated return", price-as-of, tier note, record pill.
  - All of them go in one `<details data-testid="why">` labelled "Why this bet?" (see card layout below).
  - Remove the per-figure ⓘ tips and `title` hovers from the card. Those are extra routes to the same detail, which NN/G advises against.

### R2-4. A value rating needs a word next to it, and must say what it measures
- **Why:**
  - NN/G (rating scales): "people find it easier to comprehend word-labeled scales compared to unlabeled ones."
  - Action Network's projections grade each game A–F from the edge. They say the letter grades "might be easier to
    understand for novice bettors" than the edge number, colour them (green for A, red for F), and give a plain
    threshold: "at least a Grade of B or a +3.5% Edge before considering a bet."
  - Their free tier shows locked rows as solid cells with a lock icon (screenshot `actionnetwork-projections.png`), which matches OVERHAUL §B's locked card.
- **Sources (opened):** [NN/G rating scales](https://www.nngroup.com/articles/rating-scales/) ·
  [Action Network NBA projections](https://www.actionnetwork.com/nba/projections)
- **Kismet example:** `★★☆ Good value` with `aria-label="Value: 2 of 3 stars"`. "Why this bet?" says in one sentence why it got that many (rule below).

### R2-5. Few chips in one row, and make "More filters" impossible to miss
- **Why:**
  - Baymard: "Horizontal filtering toolbars can be troublesome if there are more than 6–8 filter types." They "can only work with a limited number of filter types."
  - In testing, "All Filters" or "See More Filters" buttons "were overlooked by some participants."
  - On mobile, show applied filters in a horizontally scrolling row. Show **half or more** of the last chip so people see
    the row scrolls (a thin slice gets overlooked). Fade the right edge. Also state the count ("4 Filters Applied").
    Baymard calls combining the three "the ideal way".
  - Without an applied-filters overview, mobile users have to reopen the filter panel to remove a filter.
- **Sources (opened):** [Baymard: be careful with horizontal filtering toolbars](https://baymard.com/blog/horizontal-filtering-sorting-design) ·
  [Baymard: display applied filters in an overview](https://baymard.com/blog/how-to-design-applied-filters)
- **Kismet example:** see "Filter chip row" below. There are 3 chip groups plus "More filters". Style "More filters" as a chip with an icon and count,
  never a bare text link.

### R2-6. Loading: nothing under 1 s, skeleton cards for 1–10 s, never flash the screen
- **Why:**
  - NN/G skeleton screens: under 1 second, "skeleton screens or spinners aren't necessary." A quick flash "can cause users to feel like they can't keep up."
  - Under 10 s, skeletons or spinners both work. Spinners are "best used on a single module, like… a card". Skeletons
    are better "when the full screen is loading". Don't use frame-only skeletons.
  - Over 10 s, show a progress bar with an estimate.
  - Response-time limits: 0.1 s feels instant, 1 s keeps the flow of thought, and about 10 s is the limit of attention.
  - NN/G progress indicators: a looped animation for something under 1 s "is distracting".
- **Sources (opened):** [NN/G skeleton screens 101](https://www.nngroup.com/articles/skeleton-screens/) ·
  [NN/G response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/) ·
  [NN/G progress indicators](https://www.nngroup.com/articles/progress-indicators/)
- **Kismet example:**
  - First load of `/bets`: 5 grey card shapes the size of real cards, only if the load takes over about 1 s.
  - Tapping a chip: keep the current cards on screen, slightly dimmed, until the new list arrives. Don't swap in skeletons for a sub-second filter change.
  - *Implementation note, not a research claim:* in React this is a Transition or `useDeferredValue` around the
    filter state (react.dev could not be opened from here).

### R2-7. Always show what's filtered and what happened
- **Why:**
  - Heuristic #1: "keep users informed about what is going on, through appropriate feedback." When users know the current state, "they learn the outcome of their prior interactions and determine next steps."
  - Heuristic #6: "Minimize the user's memory load by making elements, actions, and options visible."
  - Baymard (R2-5) found that an applied-filters overview matters as much as a page title.
- **Sources (opened):** [NN/G 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) ·
  [Baymard: applied filters overview](https://baymard.com/blog/how-to-design-applied-filters)
- **Kismet example:**
  - Selected chips are filled emerald with a ✕.
  - Under the row: "12 bets · Soccer · Today" and "Clear".
  - The button reads "More filters (2)" when hidden filters are on.
  - Empty result: "No bets match. Try This week", with that chip as a button.

### R2-8. Thumb-sized targets, bigger for the main button
- **Why:**
  - NN/G: "Interactive elements must be at least 1cm × 1cm (0.4in × 0.4in)", based on Parhi, Karlson and Bederson.
  - Leave space between stacked targets.
  - Primary calls to action, and apps used on the move, warrant larger targets. Target's app uses 2 cm buttons for its main actions.
- **Sources (opened):** [NN/G touch target size](https://www.nngroup.com/articles/touch-target-size/)
- **Kismet example:**
  - Chips at least 44 px tall (1 cm is roughly 38–40 CSS px, and the repo already uses 44 px buttons per docs/17) with 8 px gaps.
  - "Bet on Polymarket" is full card width and 48 px tall.
  - The whole "Why this bet?" row is the tap target.

---

## Recommended card layout (contract §Card, 7 visible text elements)

```
┌──────────────────────────────────────────┐
│ Crystal Palace to win              ★★☆   │  1 plain title · 5 stars (aria "Value: 2 of 3 stars")
│ Bet Yes                     Good value   │  2 "Bet {side}" · word for the stars (part of 5)
│                                          │
│ Wins about 7 in 10                       │  3 the headline number, largest type (R2-1)
│ $10 wins $5.60                           │  4 PROFIT after the fee on a fixed $10 (R2-2)
│ Closes Sat 3:00 PM                       │  6 closing time
│ ┌──────────────────────────────────────┐ │
│ │          Bet on Polymarket           │ │  7 <VenueButton m s />, full width, 48 px (R2-8)
│ └──────────────────────────────────────┘ │
│ Why this bet?                         ⌄  │  the one route to the details (R2-3)
└──────────────────────────────────────────┘
```
If the e2e count treats "Good value" as an 8th element, keep the word in the aria-label and repeat it first inside "Why this bet?".
For a bet with no value at today's price, element 5 is the text "No value at today's price" (star rule below).

**Inside "Why this bet?"**, plain sentence first, in this order. Everything in it moves there from today's `BetCard.tsx`.
1. "If it wins you get $15.60 back ($10 + $5.60). If it loses, you lose the $10." Fee included, and say Polymarket's fee here is N¢ (R2-2).
2. Why the stars: "Bets like this won about 8 in 10 times. The price says 7 in 10. That gap is the value." (today's points and verdict)
3. How much history: "Based on about 270 similar past bets" (today's Strong/Thin record pill, `recordHelp`).
4. What the estimate is built from (`model_level`, CLAUDE.md rule 3) in plain words, e.g. "Based on: soccer match winners
   closing within a day". Never print the raw level name: "model" is a banned word on the card component.
5. How bets like this did in testing: today's `testedLine()` sentence, losing records included. This is the backtest
   record rule 3 requires one tap away; a /track-record link alone would be two taps.
6. Estimated return per $1 after fees (today's `RETURN_LABEL` line).
7. Price and when it was read (price line, live arrow, `price-as-of`).
8. Notes and the lower-confidence caution (`rowNotes`, `TierNote`, `LowerConfidence`).
9. "See how we track results" → /track-record.

Topic/league, watch star and alert bell are actions, not text. Lane B decides whether they stay as icon-only buttons.
Wording check for all of the above: no `lib/banned.ts` word ("edge", "spread", "pts", "model"…) and no
`test/profit-claim.ts` pattern ("expected return", "guaranteed"…). "Estimated return per $1", "Great/Good/Fair value" and
"No value at today's price" pass both.

## Star-rating rule

Stars are the **same for everyone** (CLAUDE.md rule 4). They are also **the same for Free and Paid on the same bet**,
so they use only quantities both tiers receive at the same resolution. Checked in the repo:
- `roi_pct` reaches Free only as a band with cuts at **0 / 5 / 10 / 20 / 50 %** (`lib/data/gate.ts`, `ROI`). Paid has the exact value, so `stars()` bands it the same way first. Cutoffs sit only on those edges.
- `model_neff` reaches Free exactly, so `recordLabel()` (Strong ≥ 100 / Thin) matches on both tiers.
- Do **not** use `cardReturn()`: it switches between `realistic_edge` and `roi_pct` by row and tier.

| Stars | Word | Rule (`roi_pct` band low end, record) | Plain line in "Why this bet?" |
|---|---|---|---|
| ★★★ | Great value | ≥ 10% **and** Strong record | "A big gap between the price and how bets like this did, backed by lots of similar past bets." |
| ★★☆ | Good value | ≥ 10% with Thin record, **or** 5–10% with Strong record | "A real gap, but either smaller or with fewer similar past bets behind it." |
| ★☆☆ | Fair value | any other band above 0 | "A small gap, or few similar past bets. Worth a look, not a strong case." |
| `null` | No value at today's price | edge after the fee not above zero (`edgeAbove0` false) | "At today's price this bet costs more than bets like it have won. It was a better buy earlier." |

- **Lead decision (Nov 20):** `stars(s)` returns `null` for non-positive bets, and the card shows "No value at today's price"
  where the stars go. This can happen when the live price moves, or on My list.
- The 5%/10% cutoffs are *Kismet proposals* on existing band edges. Action Network's own floor ("+3.5% Edge") puts the low
  cut in a sane range. Lane B checks on `test/fixtures` that roughly the top 5 of a normal day get ★★★ (move to the 20% edge if far more do).
  Unit-test each boundary for an exact (Paid) and a banded (Free) side.
- Stars rate the **price**, not the chance of winning. A 2-in-10 long shot can be ★★★. Say that once in the FAQ.

## Filter chip row

```
[Soccer] [NFL] [NBA] [NHL] [Tennis] [UFC] [More ▾] │ [Today] [This week] │ [Safer] [Balanced] [Bigger payouts] │ [⚙ More filters (0)]
```
- One horizontally scrolling row on phones with **at least half of the last chip visible** and a right-edge fade (R2-5).
  It may wrap to two rows on desktop. Sticky under the header. Polymarket's sports page does the same: a scrolling row of sport chips
  with live counts ("NFL 29", "NBA 103"), screenshot `polymarket-sports.png`.
- Three groups only:
  - **Sport:** the top 6 by today's bet count from `counts.json`, plus "More".
  - **When:** Today / This week. Single choice; tap again to clear.
  - **Style:** reuses the existing `chance()` bands in `lib/format.ts`. Safer = "Leans your way" (win chance ≥ 55%),
    Balanced = "Coin flip" (40–55%), Bigger payouts = "Long shot" (< 40%). This matches the onboarding tour's "Bigger payouts win less often".
- Everything else (price range, volume, closing window) goes behind "More filters": a bottom sheet with a sticky "Show N bets" button.
- Chips are 44 px tall (R2-8). Selected chips are filled emerald with a ✕ and there is a count line under the row (R2-7).
  Old results stay on screen while new ones load (R2-6).
- Filters are the user's own. The order of bets is the same server-side ranking for everyone (CLAUDE.md rule 4).

## 5 pages to imitate (screenshots at 390×844, 2× DPR, `docs/research/screens/`)

| # | Page | What to copy | Screenshot |
|---|---|---|---|
| 1 | Polymarket trade sheet: https://polymarket.com/sports/nba/nba-cha-atl-2026-11-20 → tap a price → +$10 | Big stake amount, quick-add chips `+$1 +$5 +$10 +$100`, one green dollar outcome line, one full-width button. Note its "To win" = total payout (R2-2) | `polymarket-trade.png` |
| 2 | Polymarket sports list: https://polymarket.com/sports/live | Scrolling sport chip row with counts. Each game is one card with large, coloured, tappable price buttons ("NSR 65¢") | `polymarket-sports.png` |
| 3 | Polymarket game page: https://polymarket.com/sports/nba/nba-cha-atl-2026-11-20 (**substitute for Kalshi**, see below) | One huge number per side ("Hawks 70%"), countdown to start, team badges, nothing else above the fold | `polymarket-game.png` |
| 4 | Robinhood event page: https://robinhood.com/us/en/prediction-markets/pro-football/events/af164a3b-61d8-473d-b2ec-836fb92c9273/ | Plain list: one line per outcome, plain name and a single price, no jargon, lots of space | `robinhood-event.png` |
| 5 | Action Network NBA projections: https://www.actionnetwork.com/nba/projections | Letter grade with a coloured edge bar (R2-4), a plain threshold sentence above the table, locked rows as solid cells with a lock icon (OVERHAUL §B) | `actionnetwork-projections.png` |

Attempted, not usable:
- **Kalshi market page:** Vercel Security Checkpoint "Failed to verify your browser, Code 21" (HTTP 429), saved as
  `kalshi-market-botwall.png`. news.kalshi.com returned 403 to curl. Replaced by #3.
- **DraftKings NBA odds:** the page loaded, but the odds module rendered an empty green button (probably geo-gated). Not saved.
- **FanDuel sportsbook:** HTTP 403.
- **rithmm.com:** redirects to www.rithmm.com, which failed to load in Chromium (that host is probably not on the allowlist).
- **cash.app:** HTML only, styles didn't load (asset host probably not allowed).

## Removed claims (page could not be opened, so not used)
| Claim | Host still blocked or walled |
|---|---|
| Gigerenzer & Hoffrage 16% → 46% figure; numeracy caveat; consistent/small denominators; FDA "evidence mixed" | pages.ucsd.edu, cambridge.org, sciencedirect.com, fda.gov (blocked); pmc.ncbi.nlm.nih.gov (reCAPTCHA wall) |
| Sportsbook "to win" = profit (DraftKings) vs payout incl. stake (FanDuel) | foxwoods.com, www.fanduel.com |
| Kalshi "Max payout" line, Kalshi probability article | kalshi.com (bot wall), news.kalshi.com (403) |
| eBay / SAP Fiori chip guidance | playbook.ebay.com, www.sap.com |
| Skeletons don't speed up perceived waits (Viget); React Transition behaviour | viget.com, react.dev |
| Apple 44 pt / Android 48 dp; star-ratings-hide-complaints study | arxiv.org |

To restore any of them, allow those hosts. For the PMC papers, a non-headless fetch is needed.
