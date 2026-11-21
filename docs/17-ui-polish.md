# 17 · UI polish (from Q's screenshots, Nov 16 11:20 PM)

The look is right (B colors + C cards). These fixes make it cleaner, more honest and nicer to keep open all day.

## Fix
1. **The "Unusually high — similar past bets returned +24%" line is on every top card.** Repeated on every card
   it becomes noise and undercuts the headline. Change: the card headline shows the **realistic return**
   (what similar past bets returned) when it exists; the model's raw estimate moves into the drawer and
   "Details for pros". Drop the warning line from cards; keep a small "ⓘ" tooltip that explains the number.
2. **The same game fills the grid** (Denmark vs. Norway appears 3+ times). Best bets shows **one card per
   game/event**: the best bet in it, plus "+3 more in this game" that expands inline. Toggle "Show every bet".
3. **Nav "Best bets" pill has a thick outlined box in one state and a filled pill in another.** One style: filled
   pill for the active tab; focus ring only for keyboard focus (`:focus-visible`), 2px, offset 2px.
4. **"Expected return" has a dotted underline on only one card.** Same treatment everywhere (tooltip affordance),
   or none; use a small ⓘ icon instead.
5. **Bet line competes with the big number** ("Bet / Yes · 68¢" right-aligned). Put it in one line under the
   number: "Bet **Yes** at 68¢ · pays 1.47x".
6. **Long technical sentence under the chips** ("Of these 618: 590 fill at a fair price, 28…"). Replace with
   three quiet stat chips or remove; it's for pros.
7. **Onboarding banner is as heavy as the content.** Make it a slim one-line bar, dismiss remembered.
8. **Hero takes too much height.** Smaller headline (32–36px), stats inline, so the first row of cards sits
   above the fold on a 13-inch laptop.
9. **Card actions are split** (star top-right, bell bottom-right, "Likely to hit" text bottom). Footer row:
   "$100 → +$24" left, chance label pill right; star + bell together top-right as 44px icon buttons.
10. **Drawer: "Open on Polymarket ↗" wraps to two lines** and the action row is cramped. Primary button full
    width on its own row; Save / Alert / Share (plus "Trade" when trading is on, docs/16) as an icon row under it.
11. **Drawer: the other side shows "-70%" in red** (scary and confusing). Show the other side as
    "No · 70¢ · won 91% before" without a return number, or "Not recommended" in muted text.
12. **Chart legend cut off at the bottom of the drawer**; give the chart its own height and put the legend above it.
13. **Text alignment**: numbers right-aligned in tables, left-aligned on cards; baseline-align big numbers with
    their labels; consistent 16/24px card padding; borders 1px `#1a2520` everywhere (some cards look heavier).
14. **Tags all say "Soccer"**: show the league or competition when known ("International friendly", "La Liga")
    and the game time ("Tue 2:45 PM").

## Make it worth keeping open all day (no gimmicks, all from real data)
- **Live price pulse**: when the drawer's live book changes the price, the number briefly highlights; cards on
  screen refresh their price every 60 s from `/api/book` batch (Pro), with a subtle up/down arrow.
- **"New since your last visit"** badge on cards that appeared after the user's last session.
- **Closing-soon strip** at the top: the next 5 best bets closing within 3 h with live countdowns.
- **Results ticker** (from the flag ledger): "Yesterday: 41 best bets settled · 29 hit · +11% avg" with a link
  to Results. Shows wins and losses honestly; hidden until ≥ 20 bets have settled.
- **Today summary card** on Best bets for signed-in users: saved bets closing today, alerts fired, My bets P&L.
- **Empty states with personality but plain words** ("Nothing in Weather right now. Next scan in 6 min.").
- **Skeletons** that match the card layout; no layout shift when data loads.
- Motion: 150–200 ms ease-out, respects `prefers-reduced-motion`.
