// Breadcrumbs on market and event pages (docs/19 P7): where this page sits, one click back up. Server-safe (no hooks).
// The last crumb is the page itself (aria-current), truncated on one line; earlier crumbs link.
import Link from "next/link";
import { ChevronRight } from "@/components/kit/icons";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}:${c.label}`} className={`flex items-center gap-1 ${last ? "min-w-0" : "flex-none max-sm:[&:not(:first-child)]:hidden"}`}>
              {i > 0 && <ChevronRight size={14} className="flex-none text-muted/70" />}
              {last || !c.href
                ? <span aria-current={last ? "page" : undefined} className={`truncate ${last ? "text-soft" : ""}`}>{c.label}</span>
                : <Link href={c.href} className="inline-flex min-h-11 items-center whitespace-nowrap hover:text-text md:min-h-0">{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
