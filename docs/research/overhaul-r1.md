# Overhaul research R1: conversion, value proposition, trust (T-294)

Lane R1 for `docs/OVERHAUL.md` §0. R2 covers showing data to non-experts and usability. The lead merges both into `docs/research/overhaul.md`.

Audience: casual bettors placing 1 or 2 bets, mostly on their phone.

Rule ids are `R1-n` so the lead can renumber them. Every rule cites only pages that were downloaded and read in this session (20 Nov 2026). Quotes are verbatim.

Things that could not be checked were dropped:
- Unbounce's reading-level benchmark (HTTP 403).
- The FTC endorsement and negative-option pages (Akamai 404 to non-browsers).
- The "my vs your" button test, which only exists as secondhand blog citations.
- Rithmm, OddsJam and Kalshi pages (blocked or rate-limited).

Proposed Kismet copy is on lines starting `COPY:`. Those lines were grepped with the `lib/banned.ts` patterns (§ Check at the end).

---

## The 8 rules

### R1-1. The top half of the first screen says what Kismet is, who it's for and what to do next
**Why.** Visitors decide to stay or leave in about 10 seconds, and most attention sits at the top of the first screen.
- NN/g: "To gain several minutes of user attention, you must clearly communicate your value proposition within 10 seconds."
- NN/g eyetracking (2018): "users spent about 57% of their page-viewing time above the fold". Also: "More than 65% of the viewing time above the fold was concentrated in the top half of the viewport". And: "Keep major CTAs above the fold."
- UXtweak's peer-reviewed 5-second study: on more visually complex pages, "Fewer people correctly identify the purpose" of the site.

The current mobile hero is a 4-word slogan, then a 20-word mechanism sentence, then the button. The 3-step bars push the first real bet out of view (`docs/overhaul-evidence/before/home-390x844.png`).

**Sources**
- https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/
- https://www.nngroup.com/articles/scrolling-and-attention/
- https://www.smashingmagazine.com/2023/12/five-second-testing-case-study/

**Example to copy.** At 390×844, put these in the top ~420 px: headline, one sentence, button, and a one-line no-card note. The real bet card starts right below and peeks above the fold. Nothing else goes above the card: no live counter, no bars.

### R1-2. Use everyday words, lead with the benefit and keep the mechanism for later
**Why.** CXL's value-proposition guide:
- "Clarity beats cleverness every time. If a reader can't explain your offer back to a friend in one sentence, the value proposition has failed."
- A good one "avoids hype ..., superlatives ('best'), and business jargon" and "can be read and understood in about five seconds."

Optimizely's roundup of A/B test patterns: "Short value props win over feature lists ... Lead with the main benefit, then support with proof points. Save feature details for later in the funnel."

The current sentence explains the method instead: "priced below ... after the fee and the spread". That is the mechanism, and it uses two banned words.

**Sources**
- https://cxl.com/blog/value-proposition-examples-how-to-create/
- https://www.optimizely.com/field-notes/articles/10-best-ab-testing-examples

**Example to copy.** Say what the user gets ("which bets look like good value today, how often bets like them win, what $10 pays"). "How it works" goes in the 3 steps below the fold, in words like:

COPY: 1. We check every Polymarket price, all day.
COPY: 2. We compare it with how often bets like it have won.
COPY: 3. You see the good-value ones and decide for yourself.

### R1-3. Use one primary button that says exactly what happens, with the no-risk facts right beside it
**Why.**
- NN/g on vague labels: a generic button "acts like a magnet". Their advice: "avoid a generic call-to-action and increase the information scent by stating precisely what users should expect". Also: "a link is a promise".
- Optimizely: "Replace generic 'Learn More' or 'Click Here' with CTAs describing the next step." And: "One primary button, and secondary actions as text links."
- CXL (pricing pages): "I yet have to see a test where 'Buy now' performed better than the alternatives".

**Sources**
- https://www.nngroup.com/articles/get-started/
- https://www.optimizely.com/field-notes/articles/10-best-ab-testing-examples
- https://cxl.com/blog/10-principles-of-effective-pricing-pages/

**Example to copy.** Keep "Sign up free", as §A requires. It is specific, unlike "Get started". Put the facts that remove the risk on the line under it. Any other action is a plain text link, never a second button.

COPY: Sign up free
COPY: 10 bets a day, free. No card.
COPY: See how it works

### R1-4. Show a real bet before asking for anything, and ask for the upgrade where the free limit bites
**Why.**
- NN/g on login walls: "we rarely have seen users more annoyed than when they come across a login wall". They advise pushing the ask "to the point where users are convinced of the logic behind it."
- NN/g on reciprocity: show part of the content first, then ask. In the Padova study they cite (Gamberini 2007), users gave more information when the content came first, though more of them submitted in the "form first" condition. They also show asking for a permission only "when the user taps" the feature that needs it.
- Baymard: asking for an account early makes the whole form feel like a burden. Inviting people at the end "performed better than presenting the invitation at either the outset of or during the checkout process".

**Sources**
- https://www.nngroup.com/articles/login-walls/
- https://www.nngroup.com/articles/reciprocity-principle/
- https://baymard.com/research-articles/delayed-account-creation

**Example to copy.** The hero shows one real bet card, fully readable while signed out. In the app, the upgrade prompt is the locked card from §B, placed where the free list ends, saying exactly what unlocks. No pop-up on arrival, no prompt before the first bet card.

COPY: Unlock N more bets (N is the real count, as in §B)
COPY: Pro shows every bet with live prices. 7 days free, cancel any time.

### R1-5. Signup: Google first, then email on the same screen, with the fewest fields
**Why.**
- Google's Reddit case study: "50% - 60% increase in sign ups with the button (Desktop and Android)". Button plus One Tap gave "almost 2X" conversion. This is a vendor-published case, so treat the size as an upper bound.
- Optimizely: "One test found that reducing from 11 fields to 4 increased conversions by 160%. Cut ruthlessly."
- Action Network's subscribe page (fetched) puts "Continue with Google" above the email and password fields, on the same page as the plans.

**Sources**
- https://developers.google.com/identity/sign-in/case-studies/reddit
- https://www.optimizely.com/field-notes/articles/10-best-ab-testing-examples
- https://www.actionnetwork.com/subscribe

**Example to copy.** `/signup` already puts Google first when the provider is configured (`components/auth/LoginForm.tsx`). Keep that, and make sure Google is enabled in production. Under it, use one email field and one password field. "Email me a link instead" becomes a text link, not a tab. Keep the 18+/Terms checkbox: it is a compliance rule, not friction to cut.

COPY: Continue with Google
COPY: or use your email
COPY: Email me a sign-in link instead

### R1-6. Pricing: highlight one plan, show the key differences up top, answer fears next to the button and say what happens next
**Why.**
- Speero/CXL eyetracking study on a modified SurveyGizmo pricing page: "highlighting does work to bring attention to a plan", and "Participants chose the PRO plan more often in the expensive first plan order, and when it was highlighted." Caveat from the study itself: participants were not real buyers ("Hypothetical situations don't always translate into real-life situations").
- CXL's pricing principles include "Address FUDs" (fears, uncertainties, doubts) and "Tell them what happens next": "nobody likes surprises at that stage".
- Smashing's pricing-page review praises pages that show "just a few key distinguished features" up top and keep the full comparison "further down the page" or behind a click.

**Sources**
- https://speero.com/post/the-effects-of-highlighting-a-recommended-pricing-plan-original-research
- https://cxl.com/blog/10-principles-of-effective-pricing-pages/
- https://www.smashingmagazine.com/2022/07/designing-better-pricing-page/

**Example to copy.**
- Keep the plans and prices exactly as they are.
- Mark Pro "Recommended", not "Most popular", since we have no data for that.
- Give each card 3 bullets at most. The 16-row table goes behind "Compare every feature", which already exists.
- Directly under the buttons, add the trial facts. The day-5 reminder email is OVERHAUL §F4: use this line only once it ships.

COPY: 7 days free, then $11.99 a month. We email you before the trial ends. Cancel from your account page.

### R1-7. Describe what Kismet does, never what the bettor will win: no guarantees, no money-making and no "skill beats luck"
**Why.** The UK ad regulator's rules are the most detailed public standard for tipster-like services. Kismet is US-facing, so read these as a strict benchmark, not as binding law.
- ASA tipster guidance: "Don't imply that past winnings are indicative" and "Don't imply that success is guaranteed". Tipsters should "avoid claiming that their forecasts are very likely or certain to win, or that their service is very likely to turn a profit".
- On record keeping: tipsters must show their odds "remained available ... long enough for consumers to have a reasonable opportunity to back the selections". In a 2014 Isiris ruling described on the same page, the advertiser had "chosen the specific winning period in order to artificially inflate their apparent winnings", and the complaint was upheld. In a 2017 Isiris ruling, a claimed "50 out of 55" success rate could not be matched to their own spreadsheet. The ASA told them not to claim success rates "unless they held adequate evidence".
- The CAP Code gambling section says ads must not "suggest that gambling can be a solution to financial concerns, an alternative to employment or a way to achieve financial security". The PDF fetched numbers this 16.3.4; the ASA advice page calls it 16.3.12, so cite the wording, not the number. The same section also bars ads that "exploit cultural beliefs or traditions about gambling or luck". It is not clear this covers a slogan arguing *against* luck, so it is not relied on here.
- In 2025 the ASA ruled against a PokerStars ad implying "simple actions or 'skill' could secure financial success".

The current headline "Less luck, more math." frames Kismet as a way to beat luck through method. Our reading (not a ruling) is that this sits close to the "skill" framing in the PokerStars ruling and to "don't imply that success is guaranteed". Drop it.

**Sources**
- https://www.asa.org.uk/advice-online/betting-and-gaming-tipsters.html
- https://www.asa.org.uk/advice-online/gambling-betting-and-gaming-personal-financial-problems.html
- CAP Code, gambling section: https://www.asa.org.uk/static/b324a7dd-94d6-4fb2-979365d66acb2e36/b36f7133-8d64-4ec8-8b6690a54bcfe141/The-CAP-Code-Gambling.pdf
- Isiris ruling: https://www.asa.org.uk/rulings/isiris-racing-services-a17-402463.html

**Example to copy.**
- The landing page carries no performance numbers (§E owners' call), only one plain link to /track-record.
- Requirement for /track-record: every settled best bet from day one, at the price people could actually get after Polymarket's fee, losing weeks included. Lane E is checking whether entry prices meet this. This is the ASA standard: all tips, achievable odds, the whole period.
- Never promise "win more", "beat the odds", "profit", "make money" or "guaranteed" in marketing. Naming a feature is fine, like the existing "profit and closing-price tracking". A promise is not.

COPY: See how we track results
COPY: Any single bet can lose.

### R1-8. Use social proof only if it's real and about clarity, not winnings. Until then, the real bet card is the proof
**Why.**
- CXL's eyetracking study: testimonials with photos were recalled significantly better (p = 0.0035), and "if yours are mediocre, that may be all people will remember".
- NN/g warns that the biggest risk of social proof is "the perception that too few people approve". One study participant was unimpressed by 1,000 shares.
- The ASA requires opinions to be "genuine and ... used only with the written permission of those giving them". And: "Opinions alone do not constitute substantiation."
- Action Network's subscribe page leads its reviews with "this app has paid for itself". That is a money-making claim the ASA guidance above warns against: don't copy it.

**Sources**
- https://cxl.com/research-study/social-proof/
- https://www.nngroup.com/articles/social-proof-ux/
- https://www.asa.org.uk/advice-online/betting-and-gaming-tipsters.html

**Example to copy.** Kismet has no collected testimonials, so the landing page shows none. No user counts either: NN/g's risk above applies, and counts above 3 digits are banned on the landing page. Later, use real, permissioned quotes about understanding, with a photo and first name. For example, a quote about seeing what $10 pays before betting, never one about winnings.

---

## Value propositions and headlines: 5-second scoring

**Criteria.** The three questions in OVERHAUL §A (what it is, who it's for, what to do next), plus CXL's two tests: the end benefit, and clear enough to read in about 5 seconds without hype, superlatives or jargon. Each scores 0–2, for 10 in total.

Two pass/fail gates:
- **(G1)** No banned word from `lib/banned.ts`.
- **(G2)** No outcome promise and no luck, skill or money framing (R1-7).

These scores are the author's heuristic judgment, not a user test. The lead should run a real 5-second test, such as 5 people shown the 390×844 screenshot for 5 seconds and asked "What is this site for? Who is it for? What would you do next?", before calling it settled.

Grade is a rough Flesch–Kincaid estimate from a local script. "Polymarket" inflates it. Length is in characters; at the current 48 px hero size, a 390 px phone with 16 px gutters fits roughly 14–16 characters per line.

### Value propositions (the one sentence under the headline)
| # | Copy | What | Who | Benefit | Next | Clarity | Total | G1/G2 |
|---|---|---|---|---|---|---|---|---|
| VP1 | see COPY below | 2 | 1 | 2 | 1 | 1 (24 words, ~grade 10, mechanism first) | 7 | pass/pass |
| VP2 | see COPY below | 2 | 2 ("a bet or two" names the audience) | 2 | 2 (mirrors the card: chance, $10 pays) | 2 (~grade 4) | **10** | pass/pass |
| VP3 | see COPY below | 2 | 1 | 2 | 1 | 2 (~grade 5) | 8 | pass/borderline ("stop guessing" hints at certainty) |
| now | "Kismet finds prediction-market bets priced below how often bets like them have actually won, after the fee and the spread." | 2 | 0 | 1 | 0 | 0 (~grade 10, jargon) | 3 | **fail** (priced below, spread) |

COPY: VP1: Kismet checks every Polymarket price against how often bets like it have won, and shows you the few that look like good value today.
COPY: VP2: Placing a bet or two? Kismet shows which Polymarket bets look like good value today, how often bets like them win, and what $10 pays.
COPY: VP3: Stop guessing which Polymarket bets are worth it. Kismet compares each price with how often bets like it have won and shows the good-value ones.

### Headlines
| # | Copy | Chars | What | Who | Benefit | Next | Clarity | Total | G1/G2 |
|---|---|---|---|---|---|---|---|---|---|
| H1 | see COPY below | 41 | 1 (needs the subline to name Kismet) | 2 | 2 | 2 (the bet card below answers it) | 2 | **9** | pass/pass |
| H2 | see COPY below | 39 | 2 | 1 | 2 | 1 | 2 | 8 | pass/pass |
| H3 | see COPY below | 47 | 2 | 1 | 2 | 1 | 1 ("pay more than they should" needs a reread) | 7 | pass/**fail** (reads as a profit claim) |
| now | "Less luck, more math." | 21 | 0 | 0 | 1 | 0 | 2 | 3 | pass/**fail** (our reading: luck/skill framing, close to the PokerStars ruling) |

COPY: H1: Which Polymarket bets are worth it today?
COPY: H2: Find the good-value bets on Polymarket.
COPY: H3: Polymarket bets that pay more than they should.

### Pick
**Headline H1 with VP2**, then the "Sign up free" button and the no-card line from R1-3:

COPY: Which Polymarket bets are worth it today?
COPY: Placing a bet or two? Kismet shows which Polymarket bets look like good value today, how often bets like them win, and what $10 pays.

**Why this pair:**
- H1 asks the exact question the visitor arrives with.
- VP2 answers it in the same words the card uses ("Wins about 7 in 10", "$10 wins $5.60"), so the bet card directly below is the proof.
- It promises information, not winnings.

**Fallback:** H2. Ship it if testing shows the question form reads as clickbait.

**Venue note:** if lane F1 sends US users to Polymarket US, "Polymarket" still covers both.

---

## Pages worth imitating
This lists only copy and structure seen in the downloaded page text. Layout was not visually inspected.

1. **Action Network subscribe page** (https://www.actionnetwork.com/subscribe). Plans and signup on one page.
   - Copy: 3 plan prices stacked with a "Best Value!" tag on one plan; "Continue with Google" first, then Apple and Facebook, then "or", then email and password; one line of terms consent.
   - Don't copy: "More edges. Less noise." (banned word), the long feature list, or the "paid for itself" review (R1-7, R1-8).
2. **Robinhood home** (https://robinhood.com/us/en/). A short headline, then one plain sentence, then the action.
   - Copy: "Trade all in one place", then one sentence ending "Get started with as little as $1.", then a "Get started" button. The fine print sits right under each product block ("Crypto Risk Disclosures", "Terms apply. Gold subscription $5/month.") rather than only in the footer. That is the model for putting "7 days free, then $11.99 a month" next to the trial button.
   - Don't copy: the generic "Get started" label (R1-3).
3. **Polymarket home** (https://polymarket.com/). The very first line of page text is "To trade in the US, go to polymarket.us". That is a one-line, top-of-page venue notice. Copy the pattern for Kismet's US/venue clarity (OVERHAUL §F1).

---

## Check
Every `COPY:` line was matched against the `lib/banned.ts` patterns (`edge`, `spread`, `pts`, `model`, `priced below`, `$1 share`, `walk-forward`, `EV`, `t-stat`, counts above 3 digits). Result: 0 hits. The only hits in this file are in quoted current copy and do-not-copy notes, which are not `COPY:` lines.

**Found while checking (for the lead; not R1's file):** `BIG_COUNT` in `apps/web/lib/banned.ts` has no word boundary after `[KkMm]`, so it flags any small number followed by a word starting with k or m. Confirmed with node: "Unlock 14 more bets" → true, "checked every 10 minutes" → true. Lane B's "Unlock N more bets" and any "N minutes" text will false-positive wherever `{counts: true}` is used. Suggested fix: add `\b` after `[KkMm]`.

## Source ledger (downloaded 20 Nov 2026)
| Source | Date on page | Used in |
|---|---|---|
| NN/g, How Long Do Users Stay on Web Pages | (undated in text) | R1-1 |
| NN/g, Scrolling and Attention | 2018-04-15 | R1-1 |
| NN/g, "Get Started" Stops Users | 2017-08-20 | R1-3 |
| NN/g, Login Walls | 2014-03-02 | R1-4 |
| NN/g, Reciprocity Principle | 2014-02-16 | R1-4 |
| NN/g, Social Proof in the User Experience | 2014-10-19 | R1-8 |
| Baymard, Save Account Creation for the Confirmation Step | (current) | R1-4 |
| Smashing / UXtweak, Five-Second Testing case study | 2023-12 | R1-1, scoring |
| Smashing, Designing Better Pricing Pages | 2022-07 | R1-6 |
| CXL, Value Proposition guide | (current) | R1-2, scoring |
| CXL, 10 Principles of Effective Pricing Pages | (current) | R1-3, R1-6 |
| CXL, Social Proof research | (current) | R1-8 |
| Speero, Highlighting a Recommended Plan | (current) | R1-6 |
| Optimizely, 10 A/B test examples | (current) | R1-2, R1-3, R1-5 |
| Google Identity, Reddit case study | (current) | R1-5 |
| ASA, Betting and gaming: Tipsters | (current) | R1-7, R1-8 |
| ASA, Gambling: Personal & financial problems | (current, cites 2025 rulings) | R1-7 |
| CAP Code, Gambling section (PDF) | (current) | R1-7 |
| ASA ruling, Isiris Racing Services A17-402463 (success-rate claim) | 2017 ad | R1-7 |
| Action Network /subscribe, Robinhood home, Polymarket home | live, 20 Nov 2026 | R1-5, pages to imitate |
