// Landing for signed-out visitors at / (docs/OVERHAUL.md §A, T-301; research docs/research/overhaul.md).
// Order: hero (headline, one sentence, one "Sign up free" button, one real bet card) → 3 steps → 3 more real bets →
// plans → 5-question FAQ → one link to /track-record. No performance numbers, counters, charts or jargon (§A, §E,
// R1-7, R1-8): lib/banned.ts guards the words, e2e-paid/overhaul-landing.spec.ts the rendered page.
// Server component that reads no cookies or headers (lane C renders / statically); the only client code is BetCard and
// the plan cards. Bets come through the Free gate, the same as a Free account's Best bets.
import Link from "next/link";
import { BetCard } from "@/components/market/BetCard";
import { Faq, Plans } from "@/components/pricing/Plans";
import { freeView } from "@/lib/data/gate";
import { listBody } from "@/lib/data/respond";
import { topOrStore } from "@/lib/data/top";
import { bestBetsQuery } from "@/lib/data/counts";
import { bannedHits } from "@/lib/banned";
import { behindWords } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { SITE } from "@/lib/site";
import { FREE_BEST_BETS_A_DAY } from "@/lib/entitlements";
import { planCtx } from "@/lib/billing/planCtx";
import type { ApiRow } from "@/lib/api";
import s from "./landing.module.css";

/** The chosen value proposition (docs/research/overhaul.md, R1-1, R1-2, R1-3). Alternatives: docs/overhaul-evidence/A/NOTES.md. */
export const HEADLINE = "Which Polymarket bets are worth it today?";
export const SENTENCE = "Placing a bet or two? Kismet shows which Polymarket bets look like good value today, how often bets like them win, and what $10 pays.";
export const NO_RISK = `${FREE_BEST_BETS_A_DAY} bets a day, free. No card.`;
// The landing's title and description are strings in app/page.tsx generateMetadata (lane C owns that file).

/** One bet in the hero, three below the steps. */
export const LANDING_HERO = 1;
export const LANDING_MORE = 3;
export const LANDING_SAMPLE = "landing";   // the Free daily sample key: every visitor sees the same bets for the day

const SIGNUP = "/signup";
const H2 = "font-heading text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[36px]";
const CTA = "inline-flex min-h-14 items-center justify-center rounded-input bg-accent px-8 text-[17px] font-semibold text-on-accent shadow-[0_8px_24px_-8px_rgba(16,185,129,0.55)] transition-colors hover:bg-accent-hover";
const LINK = "inline-flex min-h-11 items-center font-medium text-accent-hover underline-offset-4 hover:underline";

/** Which of the Free sample's rows the landing shows, in order. The sample arrives in Best bets order; bets on
 *  Polymarket US come first (§G2: the site serves the US), one bet per game while there are enough games (then a
 *  second line of a game fills the gap), and never a title that would put a banned word or a big number on the page
 *  (e.g. "Spread: …" lines). */
export function landingBets(rows: ApiRow[], n = LANDING_HERO + LANDING_MORE): ApiRow[] {
  const clean = rows.filter((r) => bannedHits(r.market.question, { counts: true }).length === 0);
  const ordered = [...clean.filter((r) => r.market.us?.url), ...clean.filter((r) => !r.market.us?.url)];
  const seen = new Set<string>();
  const first = ordered.filter((r) => {
    const game = r.market.event_id || r.market.id;
    return seen.has(game) ? false : (seen.add(game), true);
  });
  return [...first, ...ordered.filter((r) => !first.includes(r))].slice(0, n);
}

async function bets(): Promise<ApiRow[]> {
  try {
    // A signed-out visitor is Free: the same delayed store, Best bets query, daily sample and gate as a Free account.
    const store = freeView(await topOrStore("free"));   // T-295: top.json when it can serve Free, else the full store
    const page = await listBody(store, bestBetsQuery({ page_size: FREE_BEST_BETS_A_DAY }), "free", LANDING_SAMPLE);
    return page ? landingBets(page.rows as ApiRow[]) : [];
  } catch {
    return [];   // engine output not there yet: the page still explains the product, with no bet card
  }
}

export async function Landing() {
  const [rows, settings] = await Promise.all([bets(), getSettings()]);
  const hero = rows.slice(0, LANDING_HERO);
  const more = rows.slice(LANDING_HERO);
  const delay = behindWords(settings.free_delay_min);

  return (
    <article className="mx-auto flex w-full max-w-6xl flex-col gap-20 pb-12 md:gap-28">
      {/* 1. First screen: what it is, who it's for, what to do next, and one real bet (R1-1, R1-3, R1-4) */}
      <section aria-labelledby="hero-h" data-testid="landing-hero"
        className={`${s.hero} grid items-center gap-8 pt-4 md:pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pt-20`}>
        <div className="flex max-w-2xl flex-col gap-5 md:gap-6">
          <h1 id="hero-h" className="font-heading text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-balance sm:text-[44px] lg:text-[60px]">
            {HEADLINE}
          </h1>
          <p className="max-w-[44ch] text-[17px] leading-snug text-soft md:text-[20px]">{SENTENCE}</p>
          <div className="flex flex-col items-start gap-2.5">
            <Link href={SIGNUP} className={CTA} data-testid="landing-cta">Sign up free</Link>
            <p className="text-[15px] text-muted" data-testid="landing-no-risk">{NO_RISK}</p>
          </div>
        </div>
        {hero.length > 0 && (
          <div className="flex w-full max-w-md flex-col gap-2.5 lg:justify-self-end" data-testid="landing-hero-bet">
            <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">One of today&apos;s bets</p>
            {hero.map((r) => <div key={key(r)} className="flex"><BetCard r={r} /></div>)}
          </div>
        )}
      </section>

      {/* 2. How it works, in everyday words (R1-2) */}
      <section aria-labelledby="steps-h" data-testid="landing-steps" className="flex flex-col gap-8">
        <h2 id="steps-h" className={H2}>How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5 shadow-sm md:p-6">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-accent-bg font-heading text-[15px] font-bold text-accent-hover">{i + 1}</span>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 3. Three more real bets, readable signed out (R1-4) */}
      {more.length > 0 && (
        <section aria-labelledby="bets-h" data-testid="landing-bets" className="flex flex-col gap-8">
          <div className="flex max-w-2xl flex-col gap-3">
            <h2 id="bets-h" className={H2}>More of today&apos;s bets</h2>
            <p className="text-[17px] leading-relaxed text-soft">
              Free accounts see {FREE_BEST_BETS_A_DAY} a day like these. Any single bet can lose.
            </p>
          </div>
          <ul className="grid gap-4 md:grid-cols-3">
            {more.map((r) => <li key={key(r)} className="flex"><BetCard r={r} /></li>)}
          </ul>
        </section>
      )}

      {/* 4. Plans: the pricing page's own cards and buttons, prices unchanged (R1-6) */}
      <section id="plans" aria-labelledby="price-h" data-testid="landing-plans" className="flex scroll-mt-24 flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h2 id="price-h" className={H2}>Start free. Upgrade if you want more.</h2>
          <p className="max-w-2xl text-[17px] leading-relaxed text-soft">
            Free shows {FREE_BEST_BETS_A_DAY} bets a day, {delay}. Pro and Premium show every bet, live, and start with 7 days free. Cancel any time.
          </p>
        </div>
        <Plans delay={settings.free_delay_min} ctx={await planCtx({ user: null, tier: "free" })} />  {/* only signed-out visitors get the landing (app/page.tsx) */}
        <Link href="/pricing#compare-h" className={`${LINK} w-fit`}>Compare every feature</Link>
      </section>

      {/* 5. FAQ: the five questions a casual bettor asks before signing up (R1-7: no promise of winnings) */}
      <section aria-labelledby="faq-h" data-testid="landing-faq" className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
        <h2 id="faq-h" className={H2}>Questions</h2>
        <Faq items={faq(delay)} />
      </section>

      {/* 6. Results live on their own page, never here (§E) */}
      <p data-testid="landing-results" className="border-t border-border pt-10">
        <Link href="/track-record" className={`${LINK} text-[17px]`}>See how we track results</Link>
      </p>
    </article>
  );
}

const key = (r: ApiRow) => `${r.market.id}:${r.side.side_index}`;

export const STEPS: [string, string][] = [
  ["Sign up free", "Use Google or your email. It takes a minute and needs no card."],
  ["See today's bets", "Each bet says how often bets like it have won and what $10 pays if it wins. Tap “Why this bet?” for the details."],
  ["Bet on Polymarket, or don't", "Like one? Tap through and place it yourself on Polymarket. Kismet never places bets for you."],
];

/** Five questions, plain answers (R1-7). */
export const faq = (delay: string) => [
  { q: "Is it really free?", a: `Yes. A free account shows ${FREE_BEST_BETS_A_DAY} bets a day, ${delay}, with no card. Pro and Premium show every bet, live, and start with 7 days free. Cancel any time.` },
  { q: "Does Kismet place bets for me?", a: "No. Kismet shows bets; you decide and place them yourself on Polymarket, or not at all. The bets are picked the same way for everyone: it's market analytics, not advice." },
  { q: "What does “wins about 7 in 10” mean?", a: "Out of 10 past bets like this one, about 7 won. It comes from how similar markets settled. It's a guide, not a promise." },
  { q: "Can I lose money?", a: "Yes. Any single bet can lose, including good-value ones, and past results don't promise future ones. Only bet what you can afford to lose." },
  { q: "Who can use it?", a: `Adults ${SITE.minAge}+ in the ${SITE.countries}. Polymarket US isn't open in every state, so check your local rules before you bet.` },
];
