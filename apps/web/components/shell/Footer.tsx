import Link from "next/link";
import { BETA_FEATURES } from "@/lib/beta-list";
import { LEGAL_PAGES } from "@/components/legal/Legal";
import { SITE } from "@/lib/site";

export const DISCLAIMER = "Market analytics, not financial advice. Based on past results. 18+.";

// Rendered on every page (CLAUDE.md rule 5, docs/14 §3). Bottom padding on mobile clears the tab bar.
export function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 pb-24 pt-5 text-xs text-muted md:px-8 md:pb-5">
      <div className="flex flex-col gap-1">
        <p className="font-heading text-sm font-bold tracking-[-0.01em] text-text">Kismet. Good-value bets on Polymarket, in plain words.</p>
        <p>{DISCLAIMER}</p>
        <p>© {new Date().getFullYear()} {SITE.operator}</p>
      </div>
      <nav aria-label="Site" className="-mx-2 flex flex-wrap gap-x-0.5 md:-mx-1 md:gap-x-2 md:gap-y-1">
        {[{ href: "/about", label: "How it works" }, { href: "/pricing", label: "Pricing" }, ...LEGAL_PAGES, { href: "/status", label: "Status" },
          // Kalshi page only once it is out of beta (testers reach it from the nav) and KALSHI_DATA_PERMISSION=true
          // (same check as kalshiDataEnabled; inlined so the OG images that import DISCLAIMER from here don't pull in zod)
          ...(!BETA_FEATURES.includes("kalshi") && process.env.KALSHI_DATA_PERMISSION === "true" ? [{ href: "/kalshi", label: "Kalshi markets" }] : [])].map((p) => (
          <Link key={p.href} href={p.href} className="inline-flex min-h-11 items-center px-2 hover:text-text md:min-h-0 md:px-1 md:py-0.5">{p.label}</Link>
        ))}
      </nav>
    </footer>
  );
}
