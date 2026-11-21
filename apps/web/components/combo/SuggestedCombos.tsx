"use client";
// "Combos" row on Best bets (docs/18 §5.2, §6): the same suggestions for everyone, built from Best bets on
// different events closing within 24 h. Every number is labelled and uses the one (cautious) chance (Marc #74); the
// intro's leg counts and payouts come from the combos shown (Marc #65). Shows the combo backtest record; the server already drops a leg count
// that lost money in testing, so an empty answer hides the row.
import { useEffect, useState } from "react";
import { fetchCombos } from "@/lib/api";
import { comboLabel, rangeLine } from "@/lib/combos";
import type { CombosResponse, SuggestedCombo } from "@/lib/data/combos";
import { pays, pct, price, ret, testedLine, winsAbout } from "@/lib/format";
import { noLiveRecord } from "@/lib/proof";
import { useCombo } from "./useCombo";
import { useNear } from "@/components/screener/useNear";
import Link from "next/link";
import { BetaBadge } from "@/components/beta/BetaBadge";

const retText = (c: SuggestedCombo) =>
  c.ret_range ? (c.ret_range[1] === null ? `over ${ret(c.ret_range[0]!)}` : `${ret(c.ret_range[0] ?? 0)}–${ret(c.ret_range[1]).replace(/^\+/, "")}`) : ret(c.ret * 100);

export function SuggestedCombos() {
  const [data, setData] = useState<CombosResponse | null>(null);
  const [ref, near] = useNear();   // P6: fetched when scrolled near, not on page load
  useEffect(() => {
    if (!near) return;
    const ac = new AbortController();
    fetchCombos({ signal: ac.signal }).then(setData, () => {});
    return () => ac.abort();
  }, [near]);
  const groups = data?.groups ?? [];
  if (!groups.length) return <div ref={ref} aria-hidden="true" />;
  const combos = groups.flatMap((g) => g.combos);

  return (
    <section aria-labelledby="combos-h" data-testid="suggested-combos" className="flex flex-col gap-3">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="combos-h" className="flex items-center gap-2 text-xl font-semibold">Combos <BetaBadge /></h2>
          <Link href="/combos" className="text-sm font-medium text-accent hover:underline">See all combos</Link>
        </div>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-muted">
          <span data-testid="combos-range">{rangeLine(combos)}</span>, from Best bets on different events that close within a
          day. Bigger payout, lower chance: every leg has to win. {groups.map((g) => testedLine(g.record, `${g.size}-leg combos`)).filter(Boolean).join(". ")}. {noLiveRecord("combos")}
        </p>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {combos.map((c) => <ComboCard key={c.items.map((l) => l.market_id).join("-")} c={c} />)}
      </ul>
    </section>
  );
}

export function ComboCard({ c, wide = false }: { c: SuggestedCombo; wide?: boolean }) {
  const load = () => useCombo.setState({ legs: c.items, open: true });
  return (
    <li data-testid="combo-card" data-pays={c.pays.toFixed(3)} className={`flex flex-col gap-3 rounded-card border border-border bg-surface p-4 ${wide ? "" : "w-[300px] flex-none snap-start"}`}>
      <p className="text-xs text-muted">Combo · {c.legs} legs</p>
      <p className="-mt-2 font-heading text-[22px] font-bold leading-tight">
        <span title={`Price of the combo: ${price(c.price)} (each leg's price plus fee, multiplied). Wins if every leg wins: cautious chance ${pct(c.q_low)} (our central estimate ${pct(c.q)}).`}>Pays</span> {c.pays >= 10 ? Math.round(c.pays) : c.pays.toFixed(1)}x <span className="font-sans text-sm font-medium text-soft">· wins about {winsAbout(c.q_low)}</span>
      </p>
      <ol className="flex flex-col gap-1.5 text-[13px]">
        {c.items.map((l) => (
          <li key={l.market_id} data-testid="combo-leg" className="flex flex-col">
            <span className="line-clamp-1 text-soft">{l.question}</span>
            <span className="text-xs tabular-nums text-muted">
              <span className="font-medium text-soft">{l.outcome}</span> · Pays {pays(l.ask + l.fee)} after fee · {pct(l.q_low)} chance to win (cautious)
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-auto text-[13px] text-muted">
        Estimated return <span className="font-semibold text-accent">{retText(c)}</span> at a {pct(c.q_low)} chance to win
        <span className="block text-xs">Chances are our cautious ones; payouts include fees.</span>
      </p>
      <button type="button" onClick={load} aria-label={`Build this combo: ${comboLabel(c, winsAbout(c.q_low))}`}
        className="min-h-11 rounded-input border border-border bg-muted-bg px-3 text-sm font-medium hover:border-accent-border">
        Build this combo
      </button>
    </li>
  );
}
