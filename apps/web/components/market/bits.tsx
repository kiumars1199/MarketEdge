// Small presentational pieces shared by cards, rows and the drawer.
import Link from "next/link";
import { DASH } from "@/lib/format";
import { NOTE_TONE, type Note } from "./labels";

/** A formatted value; "—" gets the "not available" tooltip. */
export function Val({ v, title, className }: { v: string; title?: string; className?: string }) {
  return (
    <span className={className} title={v === DASH ? "not available" : title}>
      {v}
    </span>
  );
}

const w = (p: number | null | undefined) => `${Math.max(0, Math.min(1, typeof p === "number" && Number.isFinite(p) ? p : 0)) * 100}%`;

/** "Market says" vs "Won before" bars (8px on cards, 10px in the drawer). */
export function OddsBars({ market, won, big, labels = ["Market says", "Won before"], basis }: {
  market: number; won: number; big?: boolean; labels?: [string, string]; basis?: string;
}) {
  const h = big ? "h-2.5" : "h-2";
  const pct = (p: number) => (Number.isFinite(p) ? `${Math.round(p * 100)}%` : DASH);
  return (
    <div className={`flex flex-col ${big ? "gap-2.5 text-[13px]" : "gap-1.5 text-xs"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`${big ? "w-[120px]" : "w-[74px]"} flex-none text-muted`}>{labels[0]}</span>
        <div className={`${h} flex-1 rounded-full bg-muted-bg`}><div className={`${h} rounded-full bg-market-bar`} style={{ width: w(market) }} /></div>
        <span className="w-9 text-right tabular-nums">{pct(market)}</span>
      </div>
      <div className="flex items-center gap-2.5" title={basis}>
        <span className={`${big ? "w-[120px]" : "w-[74px]"} flex-none text-muted`}>{labels[1]}</span>
        <div className={`${h} flex-1 rounded-full bg-muted-bg`}><div className={`${h} rounded-full bg-accent`} style={{ width: w(won) }} /></div>
        <span className="w-9 text-right tabular-nums text-accent-soft">{pct(won)}</span>
      </div>
    </div>
  );
}

export function Notes({ notes, className = "" }: { notes: Note[]; className?: string }) {
  if (!notes.length) return null;
  return (
    <ul className={`flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${className}`}>
      {notes.map((n) => (
        <li key={n.text} className={`flex items-center gap-1.5 ${NOTE_TONE[n.tone]}`}>
          {n.tone !== "muted" && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
          {n.text}
        </li>
      ))}
    </ul>
  );
}

/** Small ⓘ that explains a number (docs/17 fix 4): same affordance on every card. Hover shows the title; keyboard
 *  and screen readers get it as the label. Sits above a card's full-cover link. */
export function InfoTip({ text, className = "" }: { text: string; className?: string }) {
  return (
    <button type="button" title={text} aria-label={text} onClick={(e) => (e.preventDefault(), e.stopPropagation())}
      className={`relative z-10 -my-2.5 -mx-1.5 inline-flex size-11 items-center justify-center rounded-full align-middle text-muted hover:text-text ${className}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><path d="M12 7.6v.1" />
      </svg>
    </button>
  );
}

/** Card-shaped placeholder (docs/17): same padding, line heights and blocks as BetCard, so nothing shifts on load. */
export function CardSkeleton() {
  return (
    <div aria-hidden="true" className="flex w-full flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-20" /></div>
      <Skeleton className="h-[42px]" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-1 h-8" />
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-input bg-muted-bg ${className}`} />;
}

/** Row/card "Alert me" control (`data-alert`, the `a` shortcut): opens the alert form for this side. */
export function AlertLink({ marketId, side, className = "" }: { marketId: string; side: 0 | 1; className?: string }) {
  return (
    <Link
      data-alert
      href={`/alerts?market=${marketId}&side=${side}`}
      aria-label="Alert me"
      title="Alert me when this price changes"
      onClick={(e) => e.stopPropagation()}
      className={`relative z-10 flex size-11 flex-none items-center justify-center rounded-input text-muted hover:bg-raised hover:text-text ${className}`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </Link>
  );
}
