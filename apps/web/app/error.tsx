"use client";
// 500 (T-76): an error in a page keeps the shell. Lane O's Sentry picks errors up from here.
import Link from "next/link";
import { useEffect } from "react";
import { btnGhost, btnPrimary } from "@/components/kit/classes";   // not the kit: its client code would load on every page

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 py-16 md:py-24">
      <p className="font-heading text-sm font-semibold tabular-nums text-negative">500</p>
      <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">Something went wrong on our side</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        Try again in a moment. If it keeps happening, the <Link href="/status" className="text-accent-hover underline-offset-4 hover:underline">status page</Link> shows
        whether the data is refreshing.
      </p>
      {error.digest && <p className="text-xs text-muted">Reference: <code className="tabular-nums">{error.digest}</code></p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={reset} className={btnPrimary}>Try again</button>
        <Link href="/" className={btnGhost}>Go to Best bets</Link>
      </div>
    </section>
  );
}
