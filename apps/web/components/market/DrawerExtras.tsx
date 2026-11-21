"use client";
// Owner: Lane D2 (T-37 "Log this bet", T-38 Kelly sizing). The drawer renders <DrawerExtras market side />.
import Link from "next/link";
import { useEffect, useState } from "react";
import { NumberInput, Segmented, btnPrimary, inner } from "@/components/kit";
import { feePerShare } from "@/lib/calc";
import { feeRate } from "@/lib/execution";
import { edge, money, pct, price, ret } from "@/lib/format";
import { kelly } from "@/lib/kelly";
import { getRepo } from "@/lib/repo";
import { useProfile } from "@/lib/repo/hooks";
import { savedWhere } from "@/lib/saved-where";
import type { Execution, Market } from "@/lib/types";

type Book = (Execution & { fetched_at: number }) | { verdict: string; book_ok: false };

async function fetchBook(token: string, q: number, cat: string, stake?: number): Promise<Book | null> {
  const p = new URLSearchParams({ token, q: String(q), cat });
  if (stake && stake > 0) p.set("stake", String(Math.round(stake * 100) / 100));
  try {
    const res = await fetch(`/api/book?${p}`);
    return res.ok ? ((await res.json()) as Book) : null;
  } catch { return null; }
}

export function DrawerExtras({ market, side }: { market: Market; side: 0 | 1 }) {
  return (
    <div className="flex flex-col gap-4">
      <Sizing market={market} side={side} />
      <LogBet key={`${market.id}:${side}`} market={market} side={side} />
    </div>
  );
}

const FRACTION_NAME: Record<string, string> = { "0.1": "10%-Kelly", "0.25": "Quarter-Kelly", "0.5": "Half-Kelly", "1": "Full Kelly" };

function Sizing({ market, side }: { market: Market; side: 0 | 1 }) {
  const profile = useProfile();
  const s = market.sides[side] ?? market.best;
  const [basis, setBasis] = useState<"low" | "est">("low");
  const q = basis === "low" ? s.win_prob_low : s.win_prob;
  const token = market.tokens[side];
  const [base, setBase] = useState<Book | null | "loading">("loading");
  const [fill, setFill] = useState<Execution["stakes"][number] | null>(null);

  useEffect(() => {
    let live = true;
    setBase("loading");
    if (!(q > 0 && q < 1) || !token) { setBase(null); return; }
    fetchBook(token, q, market.category).then((b) => live && setBase(b));
    return () => { live = false; };
  }, [token, q, market.category]);

  const ex = base && base !== "loading" && base.book_ok ? (base as Execution) : null;
  const cost = ex ? ex.best_ask + ex.fee_at_ask : s.ask + s.fee;
  const bankroll = profile.bankroll_usd;
  const k = bankroll ? kelly({ q, p: cost, bankroll, fraction: profile.kelly_fraction, capacity: ex?.capacity_usd ?? null }) : null;
  const stakeUsd = k && k.stake >= 1 ? Math.round(k.stake * 100) / 100 : 0;

  useEffect(() => {
    let live = true;
    setFill(null);
    if (!stakeUsd || !token || !ex) return;
    fetchBook(token, q, market.category, stakeUsd).then((b) => {
      if (!live || !b || !b.book_ok) return;
      const rows = (b as Execution).stakes;
      setFill(rows.find((r) => Math.abs(r.stake_usd - stakeUsd) < 0.01) ?? null);
    });
    return () => { live = false; };
  }, [stakeUsd, token, q, market.category, ex]);

  const name = FRACTION_NAME[String(profile.kelly_fraction)] ?? `${Math.round(profile.kelly_fraction * 100)}%-Kelly`;
  return (
    <section aria-labelledby="sizing-h" className={`${inner} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="sizing-h" className="font-semibold">Sizing</h3>
        <Segmented label="Win chance used for sizing" value={basis} onChange={setBasis}
          options={[{ value: "low", label: `Cautious ${pct(s.win_prob_low)}` }, { value: "est", label: `Estimate ${pct(s.win_prob)}` }]} />
      </div>
      {!bankroll ? (
        <p className="text-sm text-soft">Set your bankroll in <Link href="/settings#s-sizing" className="text-accent-hover underline-offset-2 hover:underline">Settings</Link> to see a Kelly stake for this bet.</p>
      ) : base === "loading" ? (
        <p className="text-sm text-muted" aria-live="polite">Checking the order book…</p>
      ) : !k ? (
        <p className="text-sm text-muted">Not available for this price.</p>
      ) : k.f_star <= 0 || stakeUsd === 0 ? (
        <p className="text-sm text-soft">At {price(cost)} with a {pct(q)} win chance, Kelly stakes nothing: the price is at or above the chance.</p>
      ) : (
        <p className="text-sm leading-relaxed text-soft" aria-live="polite">
          <span className="font-semibold text-text">{name} suggests {money(stakeUsd)} ({k.shares.toFixed(1)} shares).</span>{" "}
          {fill ? <>At {money(stakeUsd)} the average fill is {price(fill.avg_price)}{profile.numbers_mode === "pro" ? <> and edge {edge(fill.edge)}</> : <>, estimated return {ret(fill.roi_pct)}</>}.</> : ex ? "Checking the fill…" : "Live order book unavailable, so this uses the last scan price."}
          {k.capped && <> Capped at about {money(ex?.capacity_usd)}, what the book offers at a good price.</>}
        </p>
      )}
      <p className="text-xs text-muted">Math on your own bankroll{bankroll ? ` (${money(bankroll)})` : ""} and Kelly fraction, not advice. Change them in Settings.</p>
    </section>
  );
}

function LogBet({ market, side }: { market: Market; side: 0 | 1 }) {
  const profile = useProfile();
  const s = market.sides[side] ?? market.best;
  const rate = feeRate(market.category);
  const [mode, setMode] = useState<"usd" | "shares">("usd");
  const [amount, setAmount] = useState<number | null>(profile.default_stake_usd);
  const [cents, setCents] = useState<number | null>(+(s.ask * 100).toFixed(1));
  const [saved, setSaved] = useState(false);
  const p = cents === null ? NaN : cents / 100;
  const valid = p > 0 && p < 1 && amount !== null && amount > 0;
  const fee = valid ? feePerShare(p, rate) : 0;
  const shares = !valid ? 0 : mode === "shares" ? amount : amount / (p + fee);
  const stake = shares * (p + fee);

  const save = async () => {
    if (!valid) return;
    await getRepo().journal.insert({
      market_id: market.id, side_index: side, outcome: s.outcome, question: market.question,
      category: market.category, niche: market.niche, price: p, shares, fee, placed_at: new Date().toISOString(),
      model_win_prob: s.win_prob, model_edge: s.win_prob - p - fee, closing_price: null,
      result: null, settled_at: null, pnl_usd: null, tags: [], note: null,
    });
    setSaved(true);
  };

  return (
    <section aria-labelledby="log-h" className={`${inner} flex flex-col gap-3 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="log-h" className="font-semibold">Log this bet</h3>
        <span className="text-xs text-muted">{s.outcome} · Won before {pct(s.win_prob)}</span>
      </div>
      {saved ? (
        <p className="text-sm text-soft" role="status">
          Logged {money(stake)} on {s.outcome} at {price(p)}. <Link href="/journal" className="text-accent-hover hover:underline">See My bets</Link>{" "}
          <button type="button" className="text-muted underline-offset-2 hover:text-text hover:underline" onClick={() => setSaved(false)}>Log another</button>
        </p>
      ) : (
        <>
          <p className="text-xs text-muted">For bets you placed on Polymarket. {savedWhere().log}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              Price you paid
              <NumberInput ariaLabel="Price you paid, as a percent" value={cents} onChange={setCents} suffix="%" min={0.1} max={99.9} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              <span className="flex items-center justify-between">
                Amount
                <select aria-label="Amount in" value={mode} onChange={(e) => setMode(e.target.value as "usd" | "shares")} className="min-h-11 rounded-md bg-transparent text-xs text-accent-hover">
                  <option value="usd">in $</option><option value="shares">in shares</option>
                </select>
              </span>
              <NumberInput ariaLabel={mode === "usd" ? "Amount in dollars" : "Number of shares"} value={amount} onChange={setAmount} prefix={mode === "usd" ? "$" : undefined} min={0} />
            </label>
          </div>
          <p className="text-sm text-soft tabular-nums">
            {valid ? <>{shares.toFixed(1)} shares · {money(stake)} incl. {price(fee)} fee per share · pays {money(shares)} if it hits</> : "Enter a price between 0.1% and 99.9% and an amount."}
          </p>
          <button type="button" className={btnPrimary} onClick={save} disabled={!valid}>Log this bet</button>
        </>
      )}
    </section>
  );
}

