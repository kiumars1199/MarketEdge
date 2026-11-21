"use client";

import { Ago } from "@/components/clock";
import Link from "next/link";
import { PENDING_PREFIX } from "@/lib/api";
import { freshness } from "@/lib/freshness";
import { Inbox } from "@/components/kit/icons";

/** Amber banner once the scan is past the "fresh" window (lib/freshness: 3 h, the same line the header pill turns
 *  amber at). Scans run REFRESH_WORDS, so with the engine host or the fallback running this never shows. When it
 *  does, the page drops its own "Scanned … ago" line so the age is said once on the page. */
export function StaleBanner({ scannedAt }: { scannedAt?: number }) {
  if (!scannedAt || freshness(scannedAt) === "fresh") return null;
  return (
    <p role="status" suppressHydrationWarning className="rounded-input border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning">
      The last price scan was <Ago at={scannedAt} />, so these prices may have moved. Check the live price on the market before you bet.
    </p>
  );
}

/** Free has no delayed scan yet (right after a fresh scan, docs/15): an honest wait, not an error. */
export function PendingState({ line }: { line: string }) {
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6">
      <p className="font-semibold">New prices are on the way</p>
      <p className="max-w-prose text-sm text-muted">{line} Paid plans see live prices.</p>
      <Link href="/pricing" className="flex min-h-11 items-center rounded-input border border-border px-4 hover:border-accent-border">
        See plans
      </Link>
    </div>
  );
}

export function ErrorState({ onRetry, what = "markets", error }: { onRetry: () => void; what?: string; error?: string }) {
  if (error?.startsWith(PENDING_PREFIX)) return <PendingState line={error.slice(PENDING_PREFIX.length)} />;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6">
      <p className="font-semibold">Couldn&apos;t load {what}.</p>
      <p className="text-sm text-muted">The data server didn&apos;t answer. Try again, or check whether a scan is running.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onRetry} className="min-h-11 rounded-input bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover">
          Try again
        </button>
        <Link href="/status" className="flex min-h-11 items-center rounded-input border border-border px-4 hover:border-accent-border">
          Data status
        </Link>
      </div>
    </div>
  );
}

/** P7: one empty state everywhere: an icon, what happened in one line, and a way out (reset, or a link elsewhere). */
export function EmptyState({ title, line, onReset, resetLabel = "Reset filters", link }: {
  title: string; line: string; onReset?: () => void; resetLabel?: string; link?: { href: string; label: string };
}) {
  return (
    <div className="enter flex flex-col items-start gap-3 rounded-card border border-dashed border-border px-6 py-8">
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-muted-bg text-muted"><Inbox size={20} /></span>
      <p className="font-semibold">{title}</p>
      <p className="max-w-prose text-sm text-muted">{line}</p>
      {(onReset || link) && (
        <div className="flex flex-wrap items-center gap-2">
          {onReset && (
            <button type="button" onClick={onReset} className="min-h-11 rounded-input bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover">
              {resetLabel}
            </button>
          )}
          {link && <Link href={link.href} className="flex min-h-11 items-center rounded-input px-3 text-sm text-soft hover:bg-muted-bg hover:text-text">{link.label}</Link>}
        </div>
      )}
    </div>
  );
}
