# Polish round research (docs/19)

## P1 landing page research

Read on Nov 19, 2026 (page text via WebFetch, so motion is inferred from asset names and alt text, not watched).
Kalshi (https://kalshi.com/) answered 429 Too Many Requests and was skipped.

| Page | Structure (hero → footer) | Hero | Proof / trust | Pricing, FAQ, motion |
|---|---|---|---|---|
| [Robinhood](https://robinhood.com/us/en/) | promo banner, hero, tools, crypto, strategies, protection, learn, CTA, long legal footer | "Trade all in one place" (5 words), static image, one CTA | disclosures ("All investing involves risk"), no hero numbers | prices in running text; no FAQ; no motion visible |
| [Polymarket](https://polymarket.com/) | featured market, market browser with filters, more markets | no headline: a live market card *is* the hero | live odds and volume on every card, press logos | none; a "Live" label only |
| [Linear](https://linear.app/) | hero, three-figure feature trio, workflow blocks, changelog, quotes, CTA | 9-word headline over a real product mock | named customers, dated changelog | no pricing/FAQ on the page |
| [Ramp](https://ramp.com/) | hero with email field, product tiles, demo videos, testimonials, CTA, disclosures | "Time is money. Save both." + "Get started for free" | counts of customers, logo wall, risk line in the footer | demo video blocks |
| [Mercury](https://mercury.com/) | hero, four product rows, demo strip, testimonials, 3-step "get started", stats, security, CTA, footnotes | "Radically different banking" (3 words); a "not a bank" disclaimer right under the hero | every stat footnoted | looping card animation with start/end frames (static first frame) |
| [Betterment](https://www.betterment.com/) | hero, product cards, retirement, cash, protection, stats, 3-question FAQ, CTA, legal | 6-word headline, three checkmarks | every stat has an "as of" date | fees answered inside the FAQ; accordions |

### What we took (not copied)
1. **A live product card as proof in the hero** (Polymarket): the hero shows the top best bet from the latest scan,
   rendered with the real `BetCard`, captioned "Any single bet can lose."
2. **Short literal headline** (Mercury, Ramp): the tagline "Less luck, more math." is the h1; the mission is one line under it.
3. **Every number dated and sourced** (Betterment, Mercury): the counter says "in the latest scan, 1:40 PM EST";
   proof numbers come from `backtest.json` with a link to Results for losing weeks and limits.
4. **Risk line next to the claim, not only in the footer** (Mercury, Ramp): "Most best bets lose… the edge is the price"
   sits directly above the chart; the footer disclaimer stays.
5. **Three steps** (Mercury "get started fast"), each with a graphic built from the hero bet's own numbers
   (market price bar → record bar → the gap), so the explainer is the product, not an illustration.
6. **Pricing as one line per plan** (Betterment answers fees in text): three rows with prices from `SITE.prices`, a link to /pricing.
7. **Plain FAQ** (Betterment): "Can I lose money?", "Is this betting advice?", "Do you place bets for me?" answered directly.
8. **Motion with a static first frame** (Mercury): bars grow as they scroll into view using CSS scroll-driven animation;
   without support, or with reduced motion, the finished graphic shows. No JS.

### What we avoided
- Urgency and bonus hooks above the fold (Robinhood sweepstakes banner, Betterment promo slides).
- Unsourced superlatives and undefined social proof ("world's largest", "trusted by 1M+"). We have no testimonials and invent none.
- Casino signals (Polymarket's 5-minute up/down markets with big multipliers). Payouts appear only as "Pays 2.5x · wins about 1 in 2".
