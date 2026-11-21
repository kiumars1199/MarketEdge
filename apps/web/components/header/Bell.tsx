"use client";
// Header bell (F-23): unread count, last 50 alert events, mark all read, click → market drawer.
// No useSearchParams here: the header renders outside a Suspense boundary.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { InboxList, markAllRead, useInbox } from "@/components/alerts/Inbox";

export function Bell() {
  const { events, unread } = useInbox();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
        className="relative flex size-11 items-center justify-center rounded-input text-muted hover:bg-muted-bg hover:text-text"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span data-testid="bell-count" className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-on-accent tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Alerts inbox" className="fixed inset-x-3 top-16 z-50 flex max-h-[70dvh] flex-col overflow-hidden rounded-card border border-border bg-surface md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-[400px]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-semibold">Alerts</span>
            <button type="button" onClick={() => void markAllRead()} disabled={!unread} className="text-sm text-accent-hover hover:underline disabled:text-muted disabled:no-underline">Mark all read</button>
          </div>
          <div className="overflow-y-auto"><InboxList events={events} onOpen={() => setOpen(false)} compact /></div>
          <Link href="/alerts" onClick={() => setOpen(false)} className="border-t border-border px-4 py-3 text-center text-sm text-accent-hover hover:bg-raised">Manage alert rules</Link>
        </div>
      )}
    </div>
  );
}
