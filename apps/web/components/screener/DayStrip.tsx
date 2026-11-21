"use client";
// TodayCard on Best bets (docs/17): signed-in, the user's own saved bets, alerts and My bets P&L, never picks.
// The closing-soon strip and results ticker were removed with the plain Best bets page (docs/OVERHAUL.md §B).
import Link from "next/link";
import { formatCount, money } from "@/lib/format";
import { summarize } from "@/lib/journal";
import { useMe } from "@/lib/me";
import { DEMO_MODE } from "@/lib/repo";
import { useCollection } from "@/lib/repo/hooks";
import type { WatchSnapshot } from "@/components/watch/WatchStar";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Today, for signed-in users (and demo): only their own saved bets, alerts and bets. */
export function TodayCard() {
  const me = useMe();
  const watch = useCollection("watchlist");
  const events = useCollection("alert_events");
  const journal = useCollection("journal");
  const now = new Date();
  if (!DEMO_MODE && !me?.user) return null;
  const closing = watch.filter((w) => {
    const t = (w.snapshot as WatchSnapshot | null)?.closes_at;
    return typeof t === "number" && t * 1000 > now.getTime() && sameDay(new Date(t * 1000), now);
  });
  const fired = events.filter((e) => sameDay(new Date(e.fired_at), now));
  const s = summarize(journal);
  // P9: a new account would see "none · none · no bets logged", three empty answers above the first card. The strip
  // appears once there is something to report.
  if (!closing.length && !fired.length && !s.bets) return null;
  // one slim row, so the first cards stay above the fold (docs/17 fix 8)
  const stat = "flex min-h-11 min-w-0 items-center gap-1.5 rounded-input px-2 transition-colors duration-200 ease-out hover:bg-raised";
  return (
    <section aria-labelledby="today-h" data-testid="today" className="flex flex-wrap items-center gap-x-3 rounded-input border border-border bg-surface px-3 text-[13px] md:flex-nowrap">
      <h2 id="today-h" className="flex-none pl-2 font-sans text-[13px] font-semibold">Today</h2>
      <Link href="/watchlist" className={stat}>
        <span className="flex-none text-muted">Saved, closing today</span>
        <span className="truncate text-text">{closing.length ? `${formatCount(closing.length)} · ${(closing[0]!.snapshot as WatchSnapshot).question}` : "none"}</span>
      </Link>
      <Link href="/alerts" className={stat}>
        <span className="text-muted">Alerts fired</span>
        <span className="text-text">{fired.length || "none"}</span>
      </Link>
      <Link href="/journal" className={stat}>
        <span className="flex-none text-muted">My bets P&amp;L</span>
        <span className={`truncate ${s.settled ? (s.pnl >= 0 ? "text-accent-softer" : "text-negative") : "text-text"}`}>
          {s.bets ? `${s.settled ? money(s.pnl, true) : "no results yet"} · ${formatCount(s.open)} open` : "no bets logged"}
        </span>
      </Link>
    </section>
  );
}
