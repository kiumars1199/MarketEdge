"use client";
// One-time "Choose your topics" prompt for people who haven't onboarded. Mount at the top of / (Best bets).
import Link from "next/link";
import { useEffect, useState } from "react";
import { getRepo } from "@/lib/repo";
import { useProfile, useRepoReady } from "@/lib/repo/hooks";
import { Tour } from "./Tour";   // the first-run spotlight tour lives here too: it only shows once started

export const NUDGE_KEY = "me:v1:nudge_dismissed";
const KEY = NUDGE_KEY;

export function OnboardingNudge() {
  const { onboarded_at, favorite_topics } = useProfile();
  // #22 (Nov 20): only once the account's profile has loaded. Shown on the server render (as before), it flashed for
  // everyone who had already finished or dismissed setup, on every visit, since /bets is behind the account wall.
  const ready = useRepoReady();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try { setHidden(localStorage.getItem(KEY) === "1"); } catch { setHidden(false); }
  }, []);
  // P9: someone who already chose topics (here or in Settings) has nothing to choose
  const show = ready && !hidden && !onboarded_at && !favorite_topics.length;
  // #22: dismissing counts as skipping setup (as /onboarding's "Skip setup" does): saved to the account, so the banner
  // stays gone on every device, not only in this browser
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(KEY, "1"); } catch { /* storage off */ }
    getRepo().profile.patch({ onboarded_at: new Date().toISOString() }).catch((e) => console.error("[nudge] could not save:", e));
  };

  return (
    // docs/17 fix 7: one slim line, lighter than the content; dismissal is remembered
    // Tour keeps one place in the tree, so the nudge leaving at hydration doesn't restart it
    <><Tour />{show && <aside aria-label="Get started" className="flex min-h-11 items-center gap-3 rounded-input border border-border bg-surface pl-4 text-[13px] text-soft">
      <p className="min-w-0 flex-1 py-2 leading-snug sm:truncate sm:py-0">
        <Link href="/onboarding" className="font-semibold text-accent-hover hover:text-accent-soft">Choose your topics</Link>
        <span className="text-muted"> and we’ll show those bets first.</span>
      </p>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="flex size-11 flex-none items-center justify-center rounded-input text-muted hover:text-text">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </aside>}</>
  );
}
