"use client";
// "Export CSV" of the current view (docs/05 F-18): every page of /api/markets for `state`, flat, max 5,000 rows.
import Link from "next/link";
import { useState } from "react";
import { fetchMarkets } from "@/lib/api";
import { collectRows, MAX_ROWS, toCsv } from "@/lib/csv";
import { useEntitlements } from "@/lib/entitlements";
import type { FilterState } from "@/lib/filters/state";
import { resolveUserFilters } from "@/lib/filters/user";
import { useCollection, useProfile } from "@/lib/repo/hooks";
import { formatCount, plural } from "@/lib/format";

const btn = "inline-flex min-h-11 items-center gap-2 rounded-input border border-border bg-input px-3.5 py-2 text-[13px] text-soft hover:border-accent-border hover:text-text disabled:opacity-60";

export function ExportCsv({ state }: { state: FilterState }) {
  const { can, known } = useEntitlements();
  const { favorite_topics } = useProfile();
  const watchlist = useCollection("watchlist");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!known) return null;   // QA-A #40: no "· Pro" upsell on the "free" guess before /api/me answers
  if (!can("csv_export")) return <Link href="/pricing" className={btn}>Export CSV · Pro</Link>;

  async function run() {
    setBusy(true); setMsg(null);
    try {
      const { state: s, keep } = resolveUserFilters(state, { favorites: favorite_topics, watchlistIds: new Set(watchlist.map((w) => w.market_id)) });
      const rows = (await collectRows((page) => fetchMarkets({ ...s, group_by_event: false, page_size: 200, page }))).filter((r) => keep(r.market.id));
      const url = URL.createObjectURL(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `kismet-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(url);
      setMsg(rows.length >= MAX_ROWS ? `First ${formatCount(MAX_ROWS)} rows exported` : `${plural(rows.length, "row")} exported`);
    } catch {
      setMsg("Export failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} className={btn}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" /></svg>
        {busy ? "Exporting…" : "Export CSV"}
      </button>
      <span role="status" className="text-xs text-muted">{msg}</span>
    </span>
  );
}
