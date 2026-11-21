"use client";
// T-29, F-24: "Updated 12 min ago". Amber after 3 h, red after 6 h with "data may be stale".
// Fetches /api/meta itself (mounted in the header with no props); renders nothing until it knows.
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMeta } from "@/lib/api-core";   // not @/lib/api: zod on every page (T-295)
import { ago, behindWords } from "@/lib/format";
import { REFRESH_WORDS, freshness } from "@/lib/freshness";
import { usePageScan } from "@/lib/scanClock";
import { useNow } from "@/components/clock";

const DOT = { fresh: "bg-accent", amber: "bg-warning", red: "bg-negative" } as const;
const TEXT = { fresh: "text-muted", amber: "text-warning", red: "text-negative" } as const;

export function FreshnessPill({ scannedAt: initial }: { scannedAt?: number }) {
  const [scannedAt, setScannedAt] = useState(initial);
  const [delay, setDelay] = useState(0);
  const now = useNow(30_000);   // QA-A #34/#67: the page's one clock, so the pill's age and the body's tick together

  useEffect(() => {
    const load = () => fetchMeta().then((m) => { setScannedAt(m.meta.scanned_at); setDelay(m.delay_min ?? 0); }).catch(() => {});
    if (initial === undefined) load();
    const refetch = setInterval(load, 5 * 60_000);
    return () => clearInterval(refetch);
  }, [initial]);

  // QA-A #46: on a page built from a scan, name that scan (the body's), not whatever /api/meta's server holds
  const shown = usePageScan() ?? scannedAt;
  // #17/#73: until /api/meta answers, hold the pill's place, so the header doesn't shift when it appears
  if (shown === undefined) return <span aria-hidden="true" data-testid="freshness-pending" className="h-11 w-20 flex-none" />;
  const level = freshness(shown, now);
  const when = ago(shown, now);
  const behind = delay > 0 ? ` On the Free plan you see prices ${behindWords(delay)}.` : "";
  const title = level === "fresh"
    ? `Prices and win chances were last checked ${when}. Prices refresh ${REFRESH_WORDS}.${behind}`
    : `The last scan was ${when}. Prices may have moved since, so check the market before betting.${behind}`;

  return (
    <Link href="/status" title={title} data-testid="freshness" data-level={level}
      className={`flex min-h-11 flex-none items-center gap-1.5 whitespace-nowrap rounded-input px-2 text-xs tabular-nums hover:text-text ${TEXT[level]}`}>
      <span className={`size-[7px] shrink-0 rounded-full ${DOT[level]}`} aria-hidden="true" />
      <span className="max-xl:sr-only">Updated </span>{when}{level === "red" && <span className="sr-only"> · data may be stale</span>}
    </Link>
  );
}
