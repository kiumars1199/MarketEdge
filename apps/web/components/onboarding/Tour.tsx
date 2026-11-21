"use client";
// First-run spotlight tour (docs/19 P2c): 5 short steps over the real Best bets page, Skip on every step.
// Starts once after onboarding (Onboarding.finish sets TOUR_KEY) or from "Replay the tour" on /account (/?tour=1).
// Each step points at the first visible element its selectors match; when a section isn't on screen (another
// layout, nothing loaded yet) the step still shows, centered, without a spotlight. Escape skips.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const TOUR_KEY = "me:v1:tour";

const STEPS = [
  { sel: ['[data-testid="bet-card"]', "article[data-row]"], title: "A best bet",
    body: "Each card is a bet that looks like good value today: how often bets like it win, what $10 wins, and when it closes. Tap \"Why this bet?\" for the details. Any single bet can lose." },
  { sel: ['[data-testid="filter-bar"]', '[role="group"][aria-label="Quick filters"]'], title: "Narrow the list",
    body: "Pick a sport, a multiplier and a date, then Apply. Bigger multipliers pay more and win less often." },
  { sel: ['header [role="combobox"]', '[role="combobox"]'], title: "Search any market",
    body: "Find a team, an election or a ticker and see whether it's priced well today." },
  { sel: ['article[data-row] button[aria-label="Save"]', 'a[href="/watchlist"]'], title: "Save and get alerts",
    body: "Star a market to follow it on My list. Alerts tell you when a saved market's price moves." },
  { sel: ['header nav a[href="/track-record"]', 'a[href="/track-record"]'], title: "Check the results",
    body: "Results shows how past flagged bets actually did, wins and losses, so you can judge the numbers yourself." },
] as const;

const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const find = (sel: readonly string[]) => {
  for (const s of sel) for (const el of document.querySelectorAll(s)) if (visible(el)) return el as HTMLElement;
  return null;
};

export function Tour() {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    let start = false;
    try {
      const url = new URL(location.href);
      if (url.searchParams.get("tour") === "1") {
        start = true;
        url.searchParams.delete("tour");
        history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      }
      start ||= localStorage.getItem(TOUR_KEY) === "1";
    } catch { /* storage off: replay link still works */ }
    if (start) setStep(0);
  }, []);

  const end = useCallback(() => {
    setStep(null);
    try { localStorage.removeItem(TOUR_KEY); } catch { /* storage off */ }
  }, []);

  // Find the target (cards may still be loading: retry briefly), bring it into view, track it on scroll/resize.
  useEffect(() => {
    if (step === null) return;
    let el: HTMLElement | null = null;
    let tries = 0;
    let shifts = 0;
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    // the page still loading above the target moves it: bring it back into view a few times, then leave scrolling to the user
    const reflow = () => {
      const r = el?.getBoundingClientRect();
      if (el && r && (r.bottom < 0 || r.top > innerHeight) && shifts++ < 5) el.scrollIntoView({ block: "center" });
      measure();
    };
    const look = () => {
      el = find(STEPS[step].sel);
      if (el) { el.scrollIntoView({ block: "center" }); measure(); }
      else if (++tries < 40) timer = window.setTimeout(look, 250);   // up to 10 s for the list to load
      else setRect(null);
    };
    let timer = window.setTimeout(look, 0);
    const ro = new ResizeObserver(reflow);
    ro.observe(document.body);
    addEventListener("scroll", measure, { passive: true });
    addEventListener("resize", measure);
    next.current?.focus({ preventScroll: true });
    return () => { clearTimeout(timer); ro.disconnect(); removeEventListener("scroll", measure); removeEventListener("resize", measure); };
  }, [step]);

  // Popover below the target when it fits, else above; centered when there is no target. Clamped to the viewport.
  useLayoutEffect(() => {
    const c = card.current;
    if (step === null || !c) return;
    const w = c.offsetWidth, h = c.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 12;
    if (!rect) return setPos({ top: Math.max(16, (vh - h) / 2), left: Math.max(16, (vw - w) / 2) });
    const clampX = (x: number) => Math.min(Math.max(16, x), vw - w - 16);
    const clampY = (y: number) => Math.min(Math.max(16, y), vh - h - 16);
    const x = clampX(rect.left + rect.width / 2 - w / 2);
    if (rect.bottom >= 0 && rect.bottom + gap + h <= vh - 16) return setPos({ top: rect.bottom + gap, left: x });   // below
    if (rect.top <= vh && rect.top - gap - h >= 16) return setPos({ top: rect.top - gap - h, left: x });            // above
    if (rect.right + gap + w <= vw - 16) return setPos({ top: clampY(rect.top), left: rect.right + gap }); // right (tall cards)
    if (rect.left - gap - w >= 16) return setPos({ top: clampY(rect.top), left: rect.left - gap - w });   // left
    setPos({ top: vh - h - 16, left: x });   // phone, tall target: pinned to the bottom edge
  }, [rect, step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [step, end]);

  if (step === null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const pad = 6;

  return (
    <div className="fixed inset-0 z-[60]" data-testid="tour">
      {/* the click shield; the spotlight's own shadow dims everything else */}
      <div className="absolute inset-0" onClick={end} aria-hidden="true" style={rect ? undefined : { background: "rgb(0 0 0 / 0.6)" }} />
      {rect && (
        <div aria-hidden="true" className="pointer-events-none absolute rounded-card ring-2 ring-accent transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)" }} />
      )}
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-h" aria-describedby="tour-b"
        className="absolute w-[min(360px,calc(100vw-32px))] rounded-card border border-border bg-surface p-5 shadow-[0_12px_32px_rgb(0_0_0/0.45)] transition-[top,left] duration-300 ease-out motion-reduce:transition-none"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
        <p className="text-xs tabular-nums text-muted">{step + 1} of {STEPS.length}</p>
        <h2 id="tour-h" className="mt-1 font-heading text-lg font-semibold">{s.title}</h2>
        <p id="tour-b" className="mt-1.5 text-sm leading-relaxed text-soft">{s.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" onClick={end} className="-ml-3 min-h-11 rounded-input px-3 text-sm text-muted hover:text-text">Skip tour</button>
          <div className="flex items-center gap-2">
            {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="min-h-11 rounded-input px-3 text-sm text-muted hover:text-text">Back</button>}
            <button ref={next} type="button" onClick={() => (last ? end() : setStep(step + 1))}
              className="min-h-11 rounded-input bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover">
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
