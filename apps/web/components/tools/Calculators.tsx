"use client";
// /tools (T-27, docs/05 F-15): return calculator, payout, fee, Kelly, multi-bet EV. All client-side.
import { useState, type ReactNode } from "react";
import { Field, NumberInput, Segmented, Tabs, btn, btnGhost, card, input } from "@/components/kit";
import { expectedReturn, feePerShare, multiBet, type Bet } from "@/lib/calc";
import { FEE_RATE } from "@/lib/execution";
import { DASH, edge, money, pct, price, ret, RETURN_HELP } from "@/lib/format";
import { kelly } from "@/lib/kelly";
import { formatOdds, fromAmerican, fromDecimal } from "@/lib/odds";
import { useProfile } from "@/lib/repo/hooks";

type Tab = "return" | "payout" | "fee" | "kelly" | "multi";
const TABS = [
  { value: "return", label: "Return calculator" }, { value: "payout", label: "Payout & odds" },
  { value: "fee", label: "Fee" }, { value: "kelly", label: "Kelly sizing" }, { value: "multi", label: "Multi-bet" },
] as const;

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const FEE_OPTIONS = Object.entries(FEE_RATE).map(([k, r]) => ({ value: String(r) + ":" + k, label: `${cap(k)} · ${+(r * 100).toFixed(1)}%`, rate: r }));
const c2p = (c: number | null) => (c === null ? NaN : c / 100);

function FeeSelect({ id, value, onChange, allowNone }: { id: string; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      {allowNone && <option value="0:none">No fee</option>}
      {FEE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
const rateOf = (v: string) => Number(v.split(":")[0]);

function Layout({ inputs, result }: { inputs: ReactNode; result: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className={`${card} flex flex-col gap-4 p-5`}>{inputs}</div>
      <div className="flex flex-col gap-4">{result}</div>
    </div>
  );
}

function Headline({ label, value, sub, testId }: { label: string; value: string; sub?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-inner border border-accent-border bg-accent-bg p-5">
      <div className="text-[13px] text-accent-softer">{label}</div>
      <div data-testid={testId} className="mt-1 font-heading text-[42px] font-bold leading-[1.05] tracking-[-0.02em] text-accent-soft tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-[13px] text-accent-soft">{sub}</div>}
    </div>
  );
}

function Lines({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={`${card} divide-y divide-border px-5`}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-3 text-sm">
          <dt className="text-muted">{k}</dt><dd className="font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReturnTab() {
  const pro = useProfile().numbers_mode === "pro";
  const [p, setP] = useState<number | null>(68);
  const [q, setQ] = useState<number | null>(75);
  const [fee, setFee] = useState(FEE_OPTIONS.find((o) => o.value.endsWith(":sports"))!.value);
  const r = expectedReturn(c2p(p), c2p(q), rateOf(fee));
  return (
    <Layout
      inputs={<>
        <Field label="Price (% per share, pays $1 if it hits)">{(id) => <NumberInput id={id} value={p} onChange={setP} min={1} max={99} suffix="%" />}</Field>
        <Field label="Win chance (%)" hint="Your estimate, or Kismet's “Won before”.">{(id) => <NumberInput id={id} value={q} onChange={setQ} min={0} max={100} suffix="%" />}</Field>
        <Field label="Fee (by topic)">{(id) => <FeeSelect id={id} value={fee} onChange={setFee} allowNone />}</Field>
      </>}
      result={<>
        <Headline label="Return at this win chance (calculation)" value={r ? ret(r.roi_pct) : DASH} sub={r ? <>By this math, $100 bets average {money(r.profit_100, true)} each. Any single bet can lose.</> : "Enter a price between 1% and 99%."} />
        <Lines rows={[
          ["Break-even win chance", r ? `${(r.break_even * 100).toFixed(1)}%` : DASH],
          ["Fee per share", r ? price(r.fee) : DASH],
          ["You pay per share", r ? price(r.cost) : DASH],
          ...(pro ? [["Edge per share", r ? edge(r.edge) : DASH] as [string, ReactNode]] : []),
        ]} />
        <p className="text-xs text-muted">{RETURN_HELP}</p>
      </>}
    />
  );
}

type PayMode = "cents" | "decimal" | "american";
function PayoutTab() {
  const [mode, setMode] = useState<PayMode>("cents");
  const [v, setV] = useState<number | null>(40);
  const p = v === null ? null : mode === "cents" ? (v > 0 && v < 100 ? v / 100 : null) : mode === "decimal" ? fromDecimal(v) : fromAmerican(v);
  return (
    <Layout
      inputs={<>
        <Segmented label="Enter as" value={mode} onChange={(m) => { setMode(m); setV(m === "cents" ? 40 : m === "decimal" ? 2.5 : 150); }}
          options={[{ value: "cents", label: "Price %" }, { value: "decimal", label: "Decimal odds" }, { value: "american", label: "American odds" }]} />
        <Field label={mode === "cents" ? "Price (%)" : mode === "decimal" ? "Decimal odds (e.g. 2.50)" : "American odds (e.g. +150 or −200)"}>
          {(id) => <NumberInput id={id} value={v} onChange={setV} suffix={mode === "cents" ? "%" : undefined} />}
        </Field>
      </>}
      result={<>
        <Headline label="Payout multiplier" value={p ? `${(1 / p).toFixed(2)}×` : DASH} sub={p ? <>$100 bet pays {money(100 / p)} if it hits (profit {money(100 / p - 100)})</> : "Enter a valid price or odds."} />
        <Lines rows={[
          ["Price", p ? price(p) : DASH],
          ["Market says (implied chance)", p ? formatOdds(p, "percent") : DASH],
          ["Decimal odds", p ? formatOdds(p, "decimal") : DASH],
          ["American odds", p ? formatOdds(p, "american") : DASH],
        ]} />
        <p className="text-xs text-muted">Before fees. Polymarket shares pay $1 when they hit.</p>
      </>}
    />
  );
}

function FeeTab() {
  const [p, setP] = useState<number | null>(50);
  const [shares, setShares] = useState<number | null>(100);
  const [fee, setFee] = useState(FEE_OPTIONS.find((o) => o.value.endsWith(":sports"))!.value);
  const rate = rateOf(fee);
  const pp = c2p(p);
  const valid = pp > 0 && pp < 1;
  const per = valid ? feePerShare(pp, rate) : null;
  return (
    <Layout
      inputs={<>
        <Field label="Price (%)">{(id) => <NumberInput id={id} value={p} onChange={setP} min={1} max={99} suffix="%" />}</Field>
        <Field label="Shares">{(id) => <NumberInput id={id} value={shares} onChange={setShares} min={0} step="1" />}</Field>
        <Field label="Topic" hint="Polymarket's taker fee rate depends on the topic. Limit orders that rest on the book pay no fee.">{(id) => <FeeSelect id={id} value={fee} onChange={setFee} />}</Field>
      </>}
      result={<>
        <Headline label="Total fee" value={per !== null && shares !== null ? money(per * shares) : DASH} sub={per !== null ? <>{price(per)} per share · rate × price × (1 − price)</> : "Enter a price between 1% and 99%."} />
        <Lines rows={[
          ["Fee rate", `${+(rate * 100).toFixed(1)}%`],
          ["Cost of the shares", valid && shares !== null ? money(pp * shares) : DASH],
          ["Total with fee", per !== null && shares !== null ? money((pp + per) * shares) : DASH],
        ]} />
        <p className="text-xs text-muted">The fee is largest at 50% and shrinks toward 1% and 99%.</p>
      </>}
    />
  );
}

function KellyTab() {
  const profile = useProfile();
  const [q, setQ] = useState<number | null>(60);
  const [p, setP] = useState<number | null>(50);
  const [bank, setBank] = useState<number | null>(profile.bankroll_usd ?? 1000);
  const [frac, setFrac] = useState(String(profile.kelly_fraction));
  const [fee, setFee] = useState("0:none");
  const pp = c2p(p);
  const cost = pp + feePerShare(pp, rateOf(fee));
  const k = kelly({ q: c2p(q), p: cost, bankroll: bank ?? NaN, fraction: Number(frac) });
  const name = { "0.1": "10% Kelly", "0.25": "Quarter-Kelly", "0.5": "Half-Kelly", "1": "Full Kelly" }[frac] ?? "Kelly";
  return (
    <Layout
      inputs={<>
        <Field label="Win chance (%)">{(id) => <NumberInput id={id} value={q} onChange={setQ} min={0} max={100} suffix="%" />}</Field>
        <Field label="Price (%)">{(id) => <NumberInput id={id} value={p} onChange={setP} min={1} max={99} suffix="%" />}</Field>
        <Field label="Fee">{(id) => <FeeSelect id={id} value={fee} onChange={setFee} allowNone />}</Field>
        <Field label="Bankroll">{(id) => <NumberInput id={id} value={bank} onChange={setBank} min={0} step="1" prefix="$" />}</Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Kelly fraction</span>
          <Segmented label="Kelly fraction" value={frac} onChange={setFrac}
            options={[{ value: "0.1", label: "10%" }, { value: "0.25", label: "Quarter" }, { value: "0.5", label: "Half" }, { value: "1", label: "Full" }]} />
        </div>
      </>}
      result={<>
        <Headline label="Full Kelly (share of bankroll)" testId="full-kelly" value={k ? pct(Math.max(0, k.f_star)) : DASH}
          sub={k ? (k.f_star > 0 ? <>{name} stakes {money(k.stake)} ({k.shares.toFixed(1)} shares)</> : "No edge at this price, so Kelly stakes nothing.") : "Enter a win chance, a price between 1% and 99% and a bankroll."} />
        <Lines rows={[
          ["Formula", "(win chance − price) ÷ (1 − price)"],
          ["Price incl. fee", Number.isFinite(cost) && pp > 0 && pp < 1 ? price(cost) : DASH],
          [name, k ? money(k.stake) : DASH],
        ]} />
        <p className="text-xs text-muted">Sizing math on your own inputs, not advice. Full Kelly swings hard; most people use a fraction. A wrong win chance makes any size wrong.</p>
      </>}
    />
  );
}

const newBet = (): Bet & { key: number } => ({ key: Math.random(), stake: 100, price: 0.5, winProb: 0.55, rate: 0 });
function MultiTab() {
  const [bets, setBets] = useState(() => [newBet(), { ...newBet(), price: 0.3, winProb: 0.36 }]);
  const set = (i: number, patch: Partial<Bet>) => setBets((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const m = multiBet(bets);
  return (
    <Layout
      inputs={<>
        <p className="text-sm text-muted">Separate bets, not a parlay: each one wins or loses on its own, and the calculated profits add up.</p>
        <ol className="flex flex-col gap-3">
          {bets.map((b, i) => (
            <li key={b.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <Field label={`Bet ${i + 1} stake`}>{(id) => <NumberInput id={id} value={Number.isFinite(b.stake) ? b.stake : null} onChange={(v) => set(i, { stake: v ?? NaN })} prefix="$" min={0} />}</Field>
              <Field label="Price">{(id) => <NumberInput id={id} value={Number.isFinite(b.price) ? +(b.price * 100).toFixed(2) : null} onChange={(v) => set(i, { price: c2p(v) })} suffix="%" />}</Field>
              <Field label="Win chance">{(id) => <NumberInput id={id} value={Number.isFinite(b.winProb) ? +(b.winProb * 100).toFixed(2) : null} onChange={(v) => set(i, { winProb: c2p(v) })} suffix="%" />}</Field>
              <button type="button" className={btnGhost} aria-label={`Remove bet ${i + 1}`} onClick={() => setBets((x) => x.filter((_, j) => j !== i))} disabled={bets.length < 2}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className={`${btn} self-start`} onClick={() => setBets((b) => [...b, newBet()])} disabled={bets.length >= 12}>Add a bet</button>
      </>}
      result={<>
        <Headline label="Calculated profit, all bets" value={m ? money(m.expected_profit, true) : DASH} sub={m ? <>{ret(m.roi_pct)} calculated return on {money(m.stake)} staked, at the win chances you entered</> : "Add a bet with a stake, a price and a win chance."} />
        <Lines rows={[
          ["Bets counted", m ? String(m.valid) : DASH],
          ["Chance at least one hits", m ? pct(m.any_win) : DASH],
          ["Chance all of them lose", m ? pct(m.all_lose) : DASH],
        ]} />
        <p className="text-xs text-muted">Before fees. Assumes the bets don&apos;t depend on each other.</p>
      </>}
    />
  );
}

export function Calculators() {
  const [tab, setTab] = useState<Tab>("return");
  return (
    <div className="flex flex-col gap-5">
      <Tabs label="Calculators" value={tab} tabs={TABS} onChange={setTab} />
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)!.label}>
        {tab === "return" ? <ReturnTab /> : tab === "payout" ? <PayoutTab /> : tab === "fee" ? <FeeTab /> : tab === "kelly" ? <KellyTab /> : <MultiTab />}
      </div>
    </div>
  );
}
