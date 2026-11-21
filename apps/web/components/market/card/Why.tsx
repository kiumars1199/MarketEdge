"use client";
// "Why this bet?" (docs/OVERHAUL.md §B, rule 3): everything a card used to show on its face, one tap away and in plain
// words. First line is the payout with the stake added back (Polymarket's own sheet says "To win $X" meaning the total
// payout; the card says "$10 wins $5.60" for the profit, so this line spells out both). No banned words (lib/banned.ts):
// no "edge", "spread", "model", "pts"; counts stay under four digits.
import { useState, type ReactNode } from "react";
import type { ApiRow } from "@/lib/api";
import { betQuote, quoteStars } from "@/lib/betFigures";
import { backLine, cardVenue, STAKE, INTL_ONLY, NOT_FOR_US, starsHelp } from "@/lib/card";
import { paysBand } from "@/lib/filters/bands";   // not ./apply: zod on the landing (T-295)
import { costPct, ESTIMATE_HELP, money, pct, ret } from "@/lib/format";
import { noLiveRecord, type Proof } from "@/lib/proof";
import type { Execution, Market, Side } from "@/lib/types";
import dynamic from "next/dynamic";
// T-295: the star sits inside the closed "Why this bet?" body, so it loads on its own (keeps the landing under 150 kB)
const WatchStar = dynamic(() => import("@/components/watch/WatchStar").then((m) => m.WatchStar), {
  ssr: false,
  loading: () => <span aria-hidden="true" className="inline-block size-11" />,
});
import { venueOf } from "@/lib/trade/venue";
import { AlertLink } from "../bits";
import { drawerHref, useOpenDrawer } from "../drawer";
import { topicLabel } from "../labels";
import { useBacktest } from "../TierNote";

const TYPE_WORDS: Record<Market["market_type"], string> = {
  moneyline: "match-winner bets", spreads: "handicap bets", totals: "over/under bets", props: "in-game bets",
  "yes/no": "yes/no bets", "multi-outcome": "multiple-choice bets",
};
/** What the estimate is built from, in words: model_level nmt / niche / cat / all. */
function basisWords(m: Pick<Market, "category" | "niche" | "tags" | "market_type">, s: Pick<Side, "model_level">): string {
  const topic = topicLabel(m);
  switch (s.model_level) {
    case "nmt": return `${topic} ${TYPE_WORDS[m.market_type]}`;
    case "niche": return `${topic} bets`;
    case "cat": return `${topic} bets of every kind`;
    default: return "bets of every kind";
  }
}
/** "about 240 similar past bets"; never a four-digit count on a card. */
const pastBets = (n: number) => (n >= 1000 ? "over a thousand similar past bets" : `about ${Math.max(1, Math.round(n))} similar past bets`);

/** A count in words that never shows four digits on a card (lib/banned.ts): 240 → "240", 8,312 → "over 8 thousand". */
const countWords = (n: number) => (n >= 1000 ? `over ${Math.floor(n / 1000)} thousand` : `${Math.round(n)}`);

/** The tested record for this bet's payout band, with its sample size (QA-B #14/#51). Under TESTED_MIN bets it says
 *  so instead of showing a return: one tiny band (5 bets, +372%) next to another (−42%) reads as a contradiction. */
export const TESTED_MIN = 30;   // the same bar as Results' "Too few bets to tell" (lib/trackRecord paysRead)
export function bandTested(r: { flags?: number; win_rate?: number; roi_pct?: number } | null | undefined): { text: string; lost: boolean } {
  const n = r?.flags ?? 0;
  if (!r || !n || typeof r.roi_pct !== "number") return { text: "no tested bets at this payout yet", lost: false };
  const bets = `${countWords(n)} tested bet${n === 1 ? "" : "s"}`;
  if (n < TESTED_MIN) return { text: `too few tested bets to show a return (${bets})`, lost: false };
  const won = typeof r.win_rate === "number" ? `, won ${pct(r.win_rate)}` : "";
  return { text: `${ret(r.roi_pct)} over ${bets}${won}${r.roi_pct < 0 ? " (lost money)" : ""}`, lost: r.roi_pct < 0 };
}

/** The live record beside it: every best bet, all payouts (the ledger isn't split by payout band), with its count. */
export function liveSoFar(p: Proof | undefined): { text: string; note: string } {
  if (!p || !p.settled || p.liveRoi === null) return { text: "No settled bets yet", note: "Best bets are logged when shown and graded as their markets settle." };
  return {
    text: `${ret(p.liveRoi)} over ${countWords(p.settled)} settled best bet${p.settled === 1 ? "" : "s"}`,
    note: `All payouts together; not split by payout yet. ${calibrationNote(p.live)}`.trim(),
  };
}
/** lib/proof calibration()'s sentence, when the proof line carries one. */
function calibrationNote(live: string): string {
  const why = /Why live trails testing: (.*)$/.exec(live)?.[1];
  return why ? `Why it trails testing: ${why}` : "";
}

/** Quiet price warnings, in plain words (lib/data verdicts; no "spread"). */
function priceNotes(x: Execution | undefined): string[] {
  const out: string[] = [];
  if (x?.verdict === "not worth it") out.push("Price too high right now.");
  else if (x?.verdict === "thin") out.push("The gap between the buy and sell price takes most of the value.");
  if (x && x.book_ok !== false && x.verdict !== "not worth it" && x.capacity_usd != null && x.capacity_usd < 100)
    out.push(`Only about ${money(Math.round(x.capacity_usd))} can be bet at this price.`);
  return out;
}

function Line({ label, children, testid }: { label: string; children: ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t border-border/60 py-2 first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-text">{children}</dd>
    </div>
  );
}

/** First line of "Why this bet?": the payout for the amount the user types (Q, Nov 20: dollars only for their own
 *  stake, the way Kalshi's and Polymarket's bet slips do it). Starts at $10; not the Settings stake, because reading the
 *  profile store here pulls it into the landing bundle (over the 150 kB budget). */
function StakeBack({ q }: { q: { ask: number | null; fee: number | null } }) {
  const [n, setN] = useState(STAKE);
  return (
    <div data-testid="why-back" className="pb-2 font-medium text-text">
      <label className="text-xs text-muted">If you bet ${" "}
        <input type="number" defaultValue={STAKE}
          onChange={(e) => setN(+e.target.value > 0 ? +e.target.value : STAKE)}
          className="h-11 w-20 rounded-input border border-border bg-raised px-2 text-text" />
      </label>
      <p className="mt-1.5">{backLine(q, n)}</p>
    </div>
  );
}

export function Why({ r, livePrice }: { r: ApiRow; livePrice?: ReactNode }) {
  const { market: m, side: s } = r;
  const { open } = useOpenDrawer();
  const bt = useBacktest();
  const v = cardVenue(m, s);
  const banded = !!s.ranges;
  const back = backLine(v) !== null;
  const st = quoteStars(betQuote(m, s), s.model_neff);
  const band = paysBand({ ask: v.ask ?? s.ask });
  // #14/#51 (Mark, Nov 20): say which group the test record is (Best bets vs lower-confidence bets, at this payout) so it
  // can't be read as contradicting /track-record, which shows Best bets; and when that group lost money in testing
  // while this bet's estimate is positive, say plainly that the estimate is the less trustworthy of the two.
  // QA-B #14/#51: one tested figure per payout band, from the same by_pays record as /track-record "By payout"
  const bandRec = band ? bt?.chosen?.by_pays?.[m.tier ?? "best"]?.[band] : undefined;
  const bandWords = band ? ({ "<1.5x": "under 1.5x", "10x+": "10x or more" } as Record<string, string>)[band] ?? band.replace("-", "–") : null;
  // bands are 1 ÷ price, before the fee (backtest by_pays), so the label says so and can't contradict the card's after-fee "Pays"
  const group = `${m.tier === "edge" ? "Lower-confidence bets" : "Best bets"}${bandWords ? ` paying ${bandWords} before the fee` : ""}`;
  const tested = bt ? bandTested(bandRec) : null;
  const q = betQuote(m, s);   // the card's one payout and return (QA-B #55/#20/#37/#54)
  const clash = !!tested?.lost && (q.roi ?? 0) > 0;
  const live = bt ? liveSoFar(bt.proof) : null;
  const intl = venueOf(m);
  const notes = priceNotes(m.execution);
  return (
    <details data-testid="why" className="group relative z-10 rounded-xl border border-border/70 bg-background/40 open:bg-background/60"
      onClick={(e) => e.stopPropagation()}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 text-sm font-medium text-soft hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        Why this bet?
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-open:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="px-3 pb-3 text-[13px] leading-relaxed">
        {back && <StakeBack q={v} />}
        <dl>
          <Line label="Value" testid="why-value">{st ? st.label : "No value at today's price"}<span className="block text-xs text-muted">{starsHelp(st)}</span></Line>
          <Line label="Our estimate">Wins {pct(s.win_prob)} of the time{banded ? " (rounded down)" : ""}</Line>
          <Line label="Pays" testid="why-pays">
            {q.paysText === null
              ? "No Polymarket US price right now"
              : <><span data-testid="why-pays-x">{q.paysText}</span> after the fee
                <span className="block text-xs text-muted">Price {pct(q.ask)} plus {v.kind === "us" ? "Polymarket US's" : "Polymarket's"} {costPct(q.fee, q.ask)} fee</span></>}
            {livePrice}
          </Line>
          <Line label="Estimated return" testid="why-est">
            <span data-testid="why-return">{q.paysText === null ? "No Polymarket US price right now" : q.retText}</span>
            <span className="block text-xs text-muted">
              {q.math ? <span data-testid="why-math">{q.math}. </span> : banded ? "Free shows a range. " : null}
              {ESTIMATE_HELP} Based on {pastBets(s.model_neff)} in {basisWords(m, s)}.
            </span>
          </Line>
          <Line label="Similar past bets in testing" testid="why-tested">
            {tested
              ? <span data-testid="band-record">{group}: {tested.text}</span>
              : <span className="text-muted">Loading…</span>}
            {clash && <span data-testid="band-clash" className="block text-xs text-warning">Bets like this lost money in testing, so treat the estimated return above with caution.</span>}
          </Line>
          <Line label="Live record so far" testid="why-live">
            {m.tier === "edge"
              ? <span data-testid="band-live" className="cursor-help underline decoration-dotted underline-offset-4" title={noLiveRecord("lower-confidence bets")}>No live record for lower-confidence bets yet</span>
              : live
                ? <span data-testid="live-record">{live.text}<span className="block text-xs text-muted">{live.note}</span></span>
                : <span className="text-muted">Loading…</span>}
          </Line>
          <Line label="How sure we are" testid="why-basis">
            {s.model_neff >= 100 ? "Plenty of history" : "Little history"}: based on {pastBets(s.model_neff)} in {basisWords(m, s)}
          </Line>
          {m.tier === "edge" && <Line label="Confidence">Lower: the price beats past results by less than our cautious estimate needs.</Line>}
        </dl>
        {notes.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-warning">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        {v.kind === "intl-only" && (
          <p data-testid="why-intl" className="mt-2 text-xs text-muted">
            {INTL_ONLY}.{" "}
            <a href={intl.href} target="_blank" rel="noopener noreferrer" data-venue="polymarket-intl"
              className="inline-flex min-h-11 items-center text-soft underline underline-offset-4 hover:text-text">
              Open on international Polymarket
            </a>{" "}
            <span className="font-medium text-warning">{NOT_FOR_US}.</span>
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
          <a href={drawerHref(m.id, s.side_index)}
            onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); open(m.id, s.side_index); }}
            className="inline-flex min-h-11 items-center rounded-input px-2 text-soft underline underline-offset-4 hover:text-text">
            Full details
          </a>
          <span className="ml-auto flex items-center">
            <WatchStar marketId={m.id} side={s.side_index} market={m} />
            <AlertLink marketId={m.id} side={s.side_index} />
          </span>
        </div>
      </div>
    </details>
  );
}
