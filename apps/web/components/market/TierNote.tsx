"use client";
// docs/18 §2: second-tier ("More bets with an edge") cards say so: a muted "Lower confidence" label, the sample
// behind the estimate, and how that payout band did in the walk-forward test. Losing bands say "lost money in
// testing"; the label is never dropped.
import { useEffect, useState } from "react";
import { backtestOnce, type BacktestResponse } from "@/lib/api";
import { paysBand } from "@/lib/filters/bands";   // not ./apply: zod on the landing (T-295)
import { formatCount, exactCount, testedLine } from "@/lib/format";
import { noLiveRecord } from "@/lib/proof";
import type { FlagTier, Side } from "@/lib/types";

export function useBacktest(): BacktestResponse | null {
  const [bt, setBt] = useState<BacktestResponse | null>(null);
  useEffect(() => {
    let live = true;
    backtestOnce().then((b) => live && setBt(b), () => {});
    return () => void (live = false);
  }, []);
  return bt;
}

/** The by_pays record for this side's payout band in this tier, as a sentence (null if untested). */
function useBandLine(s: Pick<Side, "ask">, tier: FlagTier): { text: string; lost: boolean } | null {
  const bt = useBacktest();
  const band = paysBand(s);
  const rec = band ? bt?.chosen?.by_pays?.[tier]?.[band] : undefined;
  const text = testedLine(rec);
  return text ? { text, lost: (rec?.roi_pct ?? 0) < 0 } : null;
}

const LOWER_CONFIDENCE_HELP =
  "The price beats how often similar bets won, but by less than our cautious estimate needs, or in a kind of market that hasn't been tested as much as Best bets.";

export function LowerConfidence({ className = "" }: { className?: string }) {
  return (
    <span title={LOWER_CONFIDENCE_HELP} className={`whitespace-nowrap rounded-full border border-border px-2 py-px text-xs text-muted ${className}`}>
      Lower confidence
    </span>
  );
}

/** Sample size + band record. Rendered for tier "edge" only. */
export function TierNote({ s, className = "" }: { s: Pick<Side, "ask" | "model_events">; className?: string }) {
  const line = useBandLine(s, "edge");
  return (
    <p className={`text-xs leading-relaxed text-muted ${className}`}>
      <span title={`${exactCount(s.model_events)} past events behind this estimate`}>Based on {formatCount(s.model_events)} past events</span>
      {line && <> · <span data-testid="band-record" className={line.lost ? "text-warning" : "text-soft"}>{line.text}</span>
        {" "}· <span data-testid="band-live" className="cursor-help underline decoration-dotted underline-offset-4" title={noLiveRecord("lower-confidence bets")}>no live record yet</span></>}
    </p>
  );
}
