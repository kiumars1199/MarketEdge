"use client";
// Onboarding (docs/05 F-19): 3 skippable steps. Topics → favorites; how you bet → default stake; a short tour.
// Ends on the safe `next` page when sign-in brought one, else Best bets filtered to the chosen topics.
// Finishing or skipping sets profile.onboarded_at; a failed or slow save shows an error and still navigates.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TopicsPicker } from "@/components/settings/TopicsPicker";
import { toQuery } from "@/lib/filters/url";
import { FilterState } from "@/lib/filters/state";
import { money } from "@/lib/format";
import { DEMO_MODE, getRepo, repoReady } from "@/lib/repo";
import { useProfile } from "@/lib/repo/hooks";
import { TOUR_KEY } from "./Tour";
import { NUDGE_KEY } from "./OnboardingNudge";

const STAKES = [10, 25, 50, 100, 250];
const ORDER_STYLE_KEY = "me:v1:order_style"; // "market" | "limit"; read by the drawer to lead with the limit price

const STEPS = [
  { title: "What do you bet on?", line: "Your topics show first in quick filters and on Best bets." },
  { title: "How do you bet?", line: "So the numbers match how you actually place bets." },
  { title: "Thirty seconds on the screen", line: "Three things worth knowing before you start." },
];

const TOUR = [
  { title: "Best bets", body: "Each card is a bet priced lower than how often bets like it have won. The big number is what it pays: Pays 1.4x turns $100 into $140 if it wins, and next to it is how often bets like it have won. Any single bet can lose." },
  { title: "Tap a card for details", body: "The details panel shows Market says vs Won before, what a stake would fill at, and the past record behind the number." },
  { title: "Save views and markets", body: "Save a set of filters as a view to reopen it in one tap, and star markets to follow them on My list." },
];

const within = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);

/** `next`: a same-origin path already checked by the page (safeNext); "/" counts as none. */
export function Onboarding({ next }: { next?: string }) {
  const router = useRouter();
  const profile = useProfile();
  const [step, setStep] = useState(0);
  const [style, setStyle] = useState<"market" | "limit">("market");
  // Skip is disabled until hydrated (a click on the server HTML did nothing) and while finishing (one save, one navigation).
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    setReady(true);
    try { if (localStorage.getItem(ORDER_STYLE_KEY) === "limit") setStyle("limit"); } catch { /* storage off */ }
  }, []);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    // TOUR_KEY: the spotlight tour starts when setup (finished or skipped) lands on Best bets; elsewhere it waits for Replay
    try {
      localStorage.setItem(ORDER_STYLE_KEY, style);
      if (!next || next === "/") localStorage.setItem(TOUR_KEY, "1");
      localStorage.setItem(NUDGE_KEY, "1");   // P9: setup done in this browser, so no "Choose your topics" banner after it
    } catch { /* storage off */ }
    setError(null);
    let topics: string[] | undefined;
    try {
      // Signed in: wait until AuthBoot has switched to the account store, or the flag would land only in this browser.
      if (!DEMO_MODE) await within(repoReady, 8_000).catch(() => {});
      const p = await within(getRepo().profile.patch({ onboarded_at: new Date().toISOString() }), 8_000);
      if (p.favorite_topics.length) topics = p.favorite_topics;
    } catch (e) {
      console.error("[onboarding] could not save:", e);
      setError("Couldn't save your setup. You can change it any time in Settings.");
    }
    const to = next && next !== "/" ? next : `/${toQuery(FilterState.parse({ view: "flags", topics }))}`;
    router.push(to);
    // A client navigation can stall (e.g. a route still compiling); fall back to a full page load.
    setTimeout(() => { if (location.pathname === "/onboarding") location.assign(to); }, 10_000);
  }

  const setStake = (usd: number) => usd > 0 && getRepo().profile.patch({ default_stake_usd: usd });
  const choice = (on: boolean) =>
    `flex min-h-12 items-center rounded-input border px-4 py-3 text-left text-sm ${on ? "border-accent-border bg-accent-bg text-accent-soft" : "border-border bg-input text-soft hover:border-accent-border hover:text-text"}`;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 py-4 md:py-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of 3`}>
          {STEPS.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-muted-bg"}`} />)}
        </div>
        <button type="button" onClick={finish} disabled={!ready || busy} className="min-h-11 rounded-input px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-60">Skip setup</button>
      </div>

      {error && <p role="alert" className="rounded-input border border-border bg-muted-bg px-4 py-3 text-sm text-soft">{error}</p>}

      <header>
        <p className="text-sm text-muted">Step {step + 1} of 3</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-balance md:text-4xl">{STEPS[step].title}</h1>
        <p className="mt-2 text-muted">{STEPS[step].line}</p>
      </header>

      {step === 0 && <TopicsPicker />}

      {step === 1 && (
        <div className="flex flex-col gap-8">
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 font-heading text-sm font-semibold text-soft">When you place a bet, you usually…</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" aria-pressed={style === "market"} onClick={() => setStyle("market")} className={choice(style === "market")}>
                <span><span className="block font-medium">Take the price shown</span><span className="text-muted">Fills right away at the current price</span></span>
              </button>
              <button type="button" aria-pressed={style === "limit"} onClick={() => setStyle("limit")} className={choice(style === "limit")}>
                <span><span className="block font-medium">Set my own price</span><span className="text-muted">Waits until someone sells at your price</span></span>
              </button>
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 font-heading text-sm font-semibold text-soft">Typical stake</legend>
            <div className="flex flex-wrap gap-2">
              {STAKES.map((usd) => {
                const on = profile.default_stake_usd === usd;
                return <button key={usd} type="button" aria-pressed={on} onClick={() => { setCustom(""); setStake(usd); }} className={`${choice(on)} min-w-20 justify-center tabular-nums`}>{money(usd)}</button>;
              })}
              <label className="flex items-center gap-2 rounded-input border border-border bg-input px-4 text-sm text-muted focus-within:border-accent">
                Other $
                <input inputMode="numeric" value={custom} placeholder={STAKES.includes(profile.default_stake_usd) ? "—" : String(profile.default_stake_usd)}
                  onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, "").slice(0, 6); setCustom(v); setStake(Number(v)); }}
                  aria-label="Other stake in dollars" className="w-20 bg-transparent py-3 text-text tabular-nums placeholder:text-muted focus:outline-none" />
              </label>
            </div>
            <p className="text-sm text-muted">Used for the “per {money(profile.default_stake_usd)} bet” figures and the fill check.</p>
          </fieldset>
        </div>
      )}

      {step === 2 && (
        <ol className="flex flex-col divide-y divide-border border-y border-border">
          {TOUR.map((t) => (
            <li key={t.title} className="grid gap-1.5 py-5 md:grid-cols-[220px_1fr] md:gap-8">
              <h2 className="font-heading text-lg font-semibold">{t.title}</h2>
              <p className="max-w-prose leading-relaxed text-muted">{t.body}</p>
            </li>
          ))}
        </ol>
      )}

      <div className="sticky bottom-[64px] z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-background px-4 py-4 md:bottom-0 md:mx-0 md:px-0">
        {step > 0
          ? <button type="button" onClick={() => setStep(step - 1)} className="rounded-input px-4 py-2.5 text-sm text-muted hover:text-text">Back</button>
          : <span />}
        <button type="button" onClick={() => (step < 2 ? setStep(step + 1) : finish())}
          className="rounded-input bg-accent px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover">
          {step < 2 ? "Next" : "Show my best bets"}
        </button>
      </div>
    </section>
  );
}
