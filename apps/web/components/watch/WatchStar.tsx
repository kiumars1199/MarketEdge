"use client";
// Save to My list (docs/05 F-09). Toggles instantly; stores a snapshot of the numbers at save time so My list can
// show "since saved". Without `market` it fetches the market first so the snapshot is real data.
// The star changes once the server has the row; a failed write says so under the star (never a silent no-op).
import { useEffect, useId, useState } from "react";
import { fetchMarket } from "@/lib/api";
import { useEntitlements } from "@/lib/entitlements";
import { UniqueViolation, getRepo } from "@/lib/repo";
import { QuotaExceeded } from "@/lib/repo/supabase";
import { useCollection } from "@/lib/repo/hooks";
import type { Market } from "@/lib/types";

export interface WatchSnapshot {
  ask: number; win_prob: number; edge: number; roi_pct: number;
  question: string; outcome: string | null; closes_at: number; saved_side: 0 | 1;
}

function snapshotOf(m: Market, side?: 0 | 1): WatchSnapshot {
  const s = (side === undefined ? undefined : m.sides[side]) ?? m.best;
  return {
    ask: s.ask, win_prob: s.win_prob, edge: s.edge, roi_pct: s.roi_pct,
    question: m.question, outcome: side === undefined ? null : s.outcome, closes_at: m.closes_at, saved_side: s.side_index,
  };
}

export function WatchStar({ marketId, side, market, tipAlign = "right" }: { marketId: string; side?: 0 | 1; market?: Market; tipAlign?: "left" | "right" }) {
  const list = useCollection("watchlist");
  const { quota, known } = useEntitlements();
  const sideIndex = side ?? null;
  const item = list.find((w) => w.market_id === marketId && w.side_index === sideIndex);
  const full = known && !item && list.length >= quota("watchlist");   // QA-A #40: Free's cap only once the plan is known
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);   // P9: a star alone gave no sign of where the bet went
  const errId = useId();
  useEffect(() => {
    if (!savedNote) return;
    const t = setTimeout(() => setSavedNote(false), 2_500);
    return () => clearTimeout(t);
  }, [savedNote]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6_000);
    return () => clearTimeout(t);
  }, [error]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation(); // stars sit inside clickable rows
    if (busy || (!item && full)) return;
    const repo = getRepo();
    setBusy(true);
    setError(null);
    try {
      if (item) { setSavedNote(false); return await repo.watchlist.remove(item.id); }
      const row = await repo.watchlist.insert({
        market_id: marketId, side_index: sideIndex, note: null, target_price: null,
        snapshot: market ? snapshotOf(market, side) : null,
      });
      setSavedNote(true);
      if (!market) {
        const m = await fetchMarket(marketId).then((r) => r.market, () => null);
        if (m) await repo.watchlist.update(row.id, { snapshot: snapshotOf(m, side) }).catch(() => null);   // the row is saved either way
      }
    } catch (err) {
      if (err instanceof UniqueViolation) return;   // already saved in another tab
      setError(err instanceof QuotaExceeded ? "My list is full on your plan." : item ? "Couldn't remove. Try again." : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex flex-none">
      <button
        type="button"
        data-watch
        onClick={toggle}
        aria-pressed={!!item}
        aria-label={item ? "Saved" : "Save"}
        aria-busy={busy || undefined}
        aria-describedby={error ? errId : undefined}
        title={full ? "My list is full on your plan" : item ? "Saved to My list. Click to remove." : "Save to My list"}
        disabled={full}
        className={`flex size-11 flex-none items-center justify-center rounded-input hover:bg-raised disabled:opacity-40 ${busy ? "opacity-60" : ""} ${item ? "text-accent" : "text-muted hover:text-text"}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={item ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
        </svg>
      </button>
      {savedNote && !error && (
        <span role="status" className={`pointer-events-none absolute ${tipAlign === "left" ? "left-0" : "right-0"} top-full z-20 mt-1 whitespace-nowrap rounded-input border border-border bg-raised px-2 py-1 text-xs text-soft shadow`}>
          Saved to My list
        </span>
      )}
      {error && (
        <span id={errId} role="alert" className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-input border border-warning/40 bg-raised px-2 py-1 text-xs text-warning shadow">
          {error}
        </span>
      )}
    </span>
  );
}
