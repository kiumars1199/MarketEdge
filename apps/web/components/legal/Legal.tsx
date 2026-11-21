// Legal pages (docs/14 §3, T-49): plain English, owner values from config/site.json. Read mode: one narrow
// column, quiet type, a contents list. An empty owner value would show as [[...]] (none are empty).
import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";

export const LEGAL_PAGES = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/contact", label: "Contact" },
] as const;

/** Trading terms show only where order placement exists (docs/16: KALSHI_TRADING_ENV). */
export const tradingEnabled = () => !!process.env.KALSHI_TRADING_ENV;

export type Section = { id: string; title: string; body: ReactNode };

export function LegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: Section[] }) {
  return (
    <article className="mx-auto flex w-full max-w-[600px] flex-col gap-8 pb-10 text-pretty">
      <header className="flex flex-col gap-3">
        <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">{title}</h1>
        <p className="text-sm text-muted">Last updated {SITE.lastUpdated}</p>
        <div className="text-[15px] leading-relaxed text-soft">{intro}</div>
      </header>
      {sections.length > 3 && (
        <nav aria-label="On this page" className="rounded-xl border border-border bg-surface px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">On this page</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted hover:text-text"><span className="tabular-nums">{i + 1}.</span> {s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {sections.map((s, i) => (
        <section key={s.id} id={s.id} className="scroll-mt-24">
          <h2 className="text-lg font-semibold tracking-tight">
            <span className="mr-2 text-muted tabular-nums">{i + 1}.</span>{s.title}
          </h2>
          <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-soft [&_a]:text-accent-hover [&_a]:underline-offset-4 [&_a:hover]:underline [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-text [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
            {s.body}
          </div>
        </section>
      ))}
      <nav aria-label="Legal pages" className="-mx-2 flex flex-wrap gap-x-1 border-t border-border pt-3 text-sm text-muted">
        {/* §D (R2-8): 44 px tap targets on a phone */}
        {LEGAL_PAGES.map((p) => <Link key={p.href} href={p.href} className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 hover:text-text">{p.label}</Link>)}
      </nav>
    </article>
  );
}

/** mailto link for the support address, or the visible placeholder when it isn't set. */
export function SupportEmail() {
  return SITE.supportEmail.startsWith("[[") ? <span>{SITE.supportEmail}</span> : <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>;
}
