// The one marker for beta features (lib/beta.ts), so nothing in beta is mistaken for live. When a feature launches,
// remove it from BETA_FEATURES; to drop the marker everywhere, change this file.
//   pill   next to a nav link
//   banner top of the feature's own page
//   tag    on a card, button or section from a beta feature shown on a live page
import { BETA_FEATURES } from "@/lib/beta-list";

const BANNER = "Beta: only visible to admins and testers. Not live for customers.";

export function BetaBadge({ variant = "tag", className = "" }: { variant?: "pill" | "banner" | "tag"; className?: string }) {
  if (!BETA_FEATURES.length) return null;   // nothing in beta (Nov 21: Combos and Kalshi launched): no marker anywhere
  if (variant === "banner") {
    return (
      <p role="note" data-testid="beta-banner" className={`rounded-input border border-warning/50 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning ${className}`}>
        {BANNER}
      </p>
    );
  }
  const size = variant === "pill" ? "px-1.5 py-px text-[10px]" : "px-1.5 py-px text-[11px]";
  return (
    <span data-testid="beta-badge" title={BANNER} className={`inline-flex flex-none items-center rounded-full border border-warning/50 bg-warning/10 font-semibold uppercase tracking-wide text-warning ${size} ${className}`}>
      Beta
    </span>
  );
}
