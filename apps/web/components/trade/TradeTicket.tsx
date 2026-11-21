"use client";
// Kalshi paper-trading ticket (docs/16 §3 "Order ticket"). Form → Confirm (every time) → live status.
// Orders go web → extension (signs with the user's key) → Kalshi DEMO. The only order call is in the confirm handler
// (test: lib/trade/no-auto-trade.test.ts). Mounted once by <TicketHost/>; opened with openTicket().
import { ExternalLink } from "@/components/kit/icons";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Dialog, NumberInput, Segmented, btn, btnDanger, btnGhost, btnPrimary, input, inner } from "@/components/kit";
import { RETURN_HELP, money, pct, ret } from "@/lib/format";
import { getRepo } from "@/lib/repo";
import { ext, useTicket, useTradeConfig, type TicketPrefill, type TradeConfig } from "@/lib/trade/ext";
import { markFinal, recordFills, trackOrder, type OrderView, type TrackedOrder } from "@/lib/trade/fills";
import { Ticker, fillableNow, kalshiMarketUrl, ticketMath, type OrderIntent } from "@/lib/trade/intent";

interface Vault { connected: boolean; keyId: string | null; caps: { maxOrderUsd: number; maxDayUsd: number }; spentTodayCents: number }
interface Quote { ticker: string; title: string; status: string; yes_ask: number | null; no_ask: number | null; asks: { yes: [number, number][]; no: [number, number][] } }

const usd = (cents: number) => money(cents / 100);
const c = (cents: number) => `${cents}¢`;
const SIDE = ["yes", "no"] as const;

export function TicketHost() {
  const { prefill, close } = useTicket();
  const cfg = useTradeConfig();
  if (!cfg) return null;
  return (
    <Dialog open={!!prefill} onClose={close} title="Trade on Kalshi">
      {prefill && <Ticket key={`${prefill.journal.market_id}:${prefill.side}`} cfg={cfg} p={prefill} />}
    </Dialog>
  );
}

function PaperBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
      Paper mode · Kalshi demo exchange, fake money
    </span>
  );
}

type Step = { at: "form" } | { at: "confirm"; o: OrderIntent } | { at: "status"; t: TrackedOrder };

function Ticket({ cfg, p }: { cfg: TradeConfig; p: TicketPrefill }) {
  const [vault, setVault] = useState<Vault | null | "missing" | "loading">("loading");
  const [step, setStep] = useState<Step>({ at: "form" });
  const ping = useCallback(() => {
    setVault("loading");
    ext<Vault>(cfg.extensionId, { type: "ping" }).then((r) => setVault(r.ok ? r : r.missing ? "missing" : null));
  }, [cfg.extensionId]);
  useEffect(ping, [ping]);

  const venue = p.ticker ? kalshiMarketUrl(p.ticker) : null;
  return (
    <div className="flex flex-col gap-4">
      <PaperBadge />
      <p className="-mt-1 text-[15px] font-semibold leading-snug">{p.title}</p>
      {vault === "loading" ? (
        <p className="text-sm text-muted" aria-live="polite">Checking the Kismet extension…</p>
      ) : vault === "missing" || vault === null ? (
        <section className={`${inner} flex flex-col gap-3 p-4`}>
          <h3 className="font-semibold">Install the extension to trade from Kismet</h3>
          <p className="text-sm text-soft">
            Your Kalshi key stays inside the Kismet browser extension; it signs each order you confirm here. Kismet&apos;s servers never see it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/ext/connect" className={btnPrimary}>Get the extension</Link>
            {venue && <a href={venue} target="_blank" rel="noopener noreferrer" className={btn}>Open on Kalshi <ExternalLink size={15} /></a>}
            <button type="button" className={btnGhost} onClick={ping}>I installed it</button>
          </div>
        </section>
      ) : !vault.connected ? (
        <section className={`${inner} flex flex-col gap-3 p-4`}>
          <h3 className="font-semibold">Connect a Kalshi demo key</h3>
          <p className="text-sm text-soft">
            Open the Kismet side panel (click the extension icon, then the side panel) and add a trade-only demo key. Then come back here.
          </p>
          <button type="button" className={`${btn} self-start`} onClick={ping}>I connected it</button>
        </section>
      ) : step.at === "form" ? (
        <OrderForm p={p} cfg={cfg} vault={vault} onReview={(o) => setStep({ at: "confirm", o })} />
      ) : step.at === "confirm" ? (
        <Confirm p={p} cfg={cfg} o={step.o} onBack={() => setStep({ at: "form" })} onPlaced={(t) => setStep({ at: "status", t })} />
      ) : (
        <Status cfg={cfg} t={step.t} />
      )}
      <p className="text-xs text-muted">
        Prediction markets carry risk of loss. <a href={cfg.riskUrl} target="_blank" rel="noopener noreferrer" className="text-accent-hover underline-offset-2 hover:underline">Kalshi&apos;s risk disclosures <ExternalLink size={13} className="inline-block align-[-2px]" /></a>
      </p>
    </div>
  );
}

function OrderForm({ p, cfg, vault, onReview }: { p: TicketPrefill; cfg: TradeConfig; vault: Vault; onReview: (o: OrderIntent) => void }) {
  const [ticker, setTicker] = useState(p.ticker ?? "");
  const [side, setSide] = useState<0 | 1>(p.side);
  const [quote, setQuote] = useState<Quote | null | "loading" | string>(null);
  const [limit, setLimit] = useState<number | null>(p.sides[p.side].ask != null ? Math.round(p.sides[p.side].ask! * 100) : null);
  const [mode, setMode] = useState<"usd" | "contracts">("usd");
  const [amount, setAmount] = useState<number | null>(Math.min(10, vault.caps.maxOrderUsd));
  const validTicker = Ticker.safeParse(ticker.trim()).success;

  const lookup = useCallback((t: string) => {
    if (!Ticker.safeParse(t).success) return;
    setQuote("loading");
    ext<{ quote: Quote }>(cfg.extensionId, { type: "quote", ticker: t }).then((r) => setQuote(r.ok ? r.quote : r.error));
  }, [cfg.extensionId]);
  useEffect(() => { if (p.ticker) lookup(p.ticker); }, [p.ticker, lookup]);

  const q = typeof quote === "object" ? quote : null;
  const askOf = (i: 0 | 1) => (q ? (i === 0 ? q.yes_ask : q.no_ask) : null);
  // prefill the limit at the current Kalshi ask once it's known, and when the side changes
  useEffect(() => {
    const a = askOf(side);
    if (a != null && a > 0 && a < 100) setLimit(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, side]);

  const s = p.sides[side];
  const m = limit != null && amount != null ? ticketMath(mode, amount, Math.round(limit), s.winProb) : null;
  const fill = m && q ? fillableNow(q.asks[SIDE[side]], Math.round(limit!), m.count) : null;
  const leftToday = Math.max(0, vault.caps.maxDayUsd * 100 - vault.spentTodayCents);
  const capMsg = !m ? null
    : m.maxCostCents > vault.caps.maxOrderUsd * 100 ? `Over your ${money(vault.caps.maxOrderUsd)} per-order limit.`
    : m.maxCostCents > leftToday ? `Over what's left of your daily limit (${usd(leftToday)}).` : null;
  const ok = validTicker && m && !capMsg && limit != null && Number.isInteger(limit);

  const review = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    onReview({ ticker: ticker.trim().toUpperCase(), side: SIDE[side], price_cents: limit!, count: m!.count, client_order_id: crypto.randomUUID() });
  };

  return (
    <form onSubmit={review} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        Kalshi market
        {p.ticker ? (
          <span className="font-mono text-sm text-text">{p.ticker}</span>
        ) : (
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} onBlur={() => lookup(ticker.trim().toUpperCase())}
            placeholder="Demo ticker, e.g. KXHIGHNY-26NOV18-B55.5" aria-label="Kalshi market ticker" className={`${input} font-mono uppercase`} autoComplete="off" spellCheck={false} />
        )}
        <span className="text-xs font-normal text-muted" aria-live="polite">
          {quote === "loading" ? "Getting Kalshi's prices…" : typeof quote === "string" ? <span className="text-warning">{quote}</span> : q ? q.title : !p.ticker ? "No Kalshi match for this market yet: paste a demo-exchange ticker." : ""}
        </span>
      </label>

      <Segmented label="Side" value={String(side) as "0" | "1"} onChange={(v) => setSide(v === "1" ? 1 : 0)}
        options={[0, 1].map((i) => ({ value: String(i) as "0" | "1", label: `${i === 0 ? "Yes" : "No"}${p.sides[i as 0 | 1].label && p.sides[i as 0 | 1].label !== (i === 0 ? "Yes" : "No") ? ` · ${p.sides[i as 0 | 1].label}` : ""}${askOf(i as 0 | 1) != null ? ` · ${askOf(i as 0 | 1)}¢` : ""}` }))} />

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Limit price
          <NumberInput ariaLabel="Limit price in cents" value={limit} onChange={setLimit} step="1" min={1} max={99} suffix="¢" />
          <span className="font-normal">You never pay more than this.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          <span className="flex items-center justify-between">
            Amount
            <select aria-label="Amount in" value={mode} onChange={(e) => setMode(e.target.value as "usd" | "contracts")} className="min-h-11 rounded-md bg-transparent text-xs text-accent-hover">
              <option value="usd">in $</option><option value="contracts">in contracts</option>
            </select>
          </span>
          <NumberInput ariaLabel={mode === "usd" ? "Amount in dollars" : "Number of contracts"} value={amount} onChange={setAmount} prefix={mode === "usd" ? "$" : undefined} min={1} step={mode === "usd" ? "any" : "1"} />
        </label>
      </div>

      {m ? (
        <dl className={`${inner} grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 p-4 text-sm tabular-nums`}>
          <dt className="text-muted">Contracts</dt><dd className="m-0 text-right">{m.count.toLocaleString("en-US")} at up to {c(limit!)}</dd>
          <dt className="text-muted">Kalshi fee (estimate)</dt><dd className="m-0 text-right">{usd(m.feeCents)}</dd>
          <dt className="text-muted">Max cost</dt><dd className="m-0 text-right font-semibold">{usd(m.maxCostCents)}</dd>
          <dt className="text-muted">Pays if it wins</dt><dd className="m-0 text-right">{usd(m.payoutCents)}</dd>
          <dt className="text-muted"><span title={RETURN_HELP} className="underline decoration-dotted underline-offset-4">Kismet estimated return</span></dt>
          <dd className={`m-0 text-right font-semibold ${m.roiPct != null && m.roiPct >= 0 ? "text-accent" : "text-negative"}`} title={s.winProb != null ? `Won ${pct(s.winProb)} before` : undefined}>{ret(m.roiPct)}</dd>
          <dt className="text-muted">Price check</dt>
          <dd className="m-0 text-right text-soft">
            {!fill ? "—" : fill.rests === 0 ? <span className="text-accent">All fill now at {c(Math.round(fill.avgCents!))} avg</span>
              : fill.now === 0 ? <span className="text-warning">No sellers at {c(limit!)}: it waits on the book</span>
              : <span className="text-warning">{fill.now} fill now, {fill.rests} wait on the book</span>}
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-muted">Enter a limit price from 1¢ to 99¢ and an amount that buys at least one contract.</p>
      )}

      <p className="text-xs text-muted">
        Your limits (set in the extension): {money(vault.caps.maxOrderUsd)} per order · {usd(leftToday)} left today.
        {capMsg && <span className="mt-1 block text-warning" role="alert">{capMsg}</span>}
      </p>
      <button type="submit" className={btnPrimary} disabled={!ok}>Review order</button>
    </form>
  );
}

/** Asks our server for a one-time nonce bound to this order, then hands both to the extension. */
async function placeOrder(cfg: TradeConfig, o: OrderIntent): Promise<{ ok: true; order_id: string } | { ok: false; error: string }> {
  const res = await fetch("/api/trade/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "place", payload: o }) });
  const j = (await res.json().catch(() => ({}))) as { nonce?: string; error?: string };
  if (!res.ok || !j.nonce) return { ok: false, error: j.error ?? "Couldn't confirm the order with Kismet." };
  return ext<{ order_id: string }>(cfg.extensionId, { type: "place", nonce: j.nonce, order: o });
}

function Confirm({ p, cfg, o, onBack, onPlaced }: { p: TicketPrefill; cfg: TradeConfig; o: OrderIntent; onBack: () => void; onPlaced: (t: TrackedOrder) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = ticketMath("contracts", o.count, o.price_cents, null)!;
  const i = o.side === "yes" ? 0 : 1;

  // The confirm screen's button is the only way an order is placed.
  const onConfirm = async () => {
    setBusy(true);
    setErr(null);
    const r = await placeOrder(cfg, o);
    if (!r.ok) { setErr(r.error); setBusy(false); return; }
    const t: TrackedOrder = {
      order_id: r.order_id, ticker: o.ticker, side_index: i, outcome: p.sides[i].label, win_prob: p.sides[i].winProb,
      ...p.journal, limit_cents: o.price_cents, placed_at: new Date().toISOString(),
    };
    trackOrder(t);
    onPlaced(t);
  };

  return (
    <section aria-labelledby="confirm-h" className="flex flex-col gap-4">
      <div className="rounded-inner border border-accent-border bg-accent-bg p-4">
        <h3 id="confirm-h" className="font-semibold text-accent-soft">Confirm this paper order</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-text tabular-nums">
          Buy <strong>{o.count.toLocaleString("en-US")} {o.side === "yes" ? "Yes" : "No"}</strong> contracts on <span className="font-mono text-sm">{o.ticker}</span> at up to <strong>{c(o.price_cents)}</strong> each.
        </p>
        <p className="mt-1 text-sm text-soft tabular-nums">Max cost {usd(m.maxCostCents)} including about {usd(m.feeCents)} in fees · pays {usd(m.payoutCents)} if it wins.</p>
      </div>
      <p className="text-xs text-muted">Every order needs this confirmation. Kismet never places orders by itself. Unfilled contracts wait on Kalshi&apos;s book until they fill or you cancel.</p>
      {err && <p role="alert" className="text-sm text-negative">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className={`${btnPrimary} flex-1`} onClick={onConfirm} disabled={busy}>{busy ? "Placing…" : "Place paper order"}</button>
      </div>
    </section>
  );
}

const STATE_LABEL: Record<OrderView["state"], string> = { resting: "Waiting on the book", partial: "Partly filled", filled: "Filled", cancelled: "Cancelled" };

function Status({ cfg, t }: { cfg: TradeConfig; t: TrackedOrder }) {
  const [v, setV] = useState<OrderView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    const r = await ext<{ order: OrderView | null }>(cfg.extensionId, { type: "order", order_id: t.order_id });
    if (!r.ok) { setErr(r.error); return null; }
    setErr(null);
    if (!r.order) return null;
    setV(r.order);
    if (await recordFills(getRepo(), t, r.order)) setLogged(true);
    if (r.order.state === "filled" || r.order.state === "cancelled") markFinal(t.order_id);
    return r.order;
  }, [cfg.extensionId, t]);

  // Read-only status polling while the ticket is open; stops once the order is final.
  const final = v?.state === "filled" || v?.state === "cancelled";
  useEffect(() => {
    if (final) return;
    void refresh();
    const id = setInterval(() => document.visibilityState === "visible" && void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh, final]);

  const cancel = async () => {
    setCancelling(true);
    const payload = { order_id: t.order_id, ticker: t.ticker };
    const res = await fetch("/api/trade/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", payload }) });
    const j = (await res.json().catch(() => ({}))) as { nonce?: string; error?: string };
    const r = j.nonce ? await ext(cfg.extensionId, { type: "cancel", nonce: j.nonce, ...payload }) : { ok: false as const, error: j.error ?? "Couldn't cancel." };
    if (!r.ok) setErr(r.error);
    await refresh();
    setCancelling(false);
  };

  const state = v?.state ?? "resting";
  return (
    <section aria-label="Order status" className="flex flex-col gap-4">
      <div className={`${inner} flex flex-col gap-3 p-4`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted">Order {t.order_id.slice(0, 8)}</span>
          <span data-state={state} aria-live="polite" className={`rounded-full px-2.5 py-1 text-xs font-medium ${state === "filled" ? "bg-accent-bg text-accent-soft" : state === "cancelled" ? "bg-muted-bg text-muted" : "bg-warning/10 text-warning"}`}>
            {v ? STATE_LABEL[state] : "Sent to Kalshi…"}
          </span>
        </div>
        {v && (
          <p className="text-sm text-soft tabular-nums">
            {v.filled} of {v.filled + v.remaining} filled{v.avg_price_cents != null ? ` at ${v.avg_price_cents}¢ avg` : ""}{v.fees_cents ? ` · fees ${usd(v.fees_cents)}` : ""}
          </p>
        )}
        {logged && <p className="text-sm text-accent-soft" role="status">Fills added to <Link href="/journal" onClick={useTicket.getState().close} className="underline underline-offset-2">My bets</Link>.</p>}
        {err && <p role="alert" className="text-sm text-negative">{err}</p>}
      </div>
      {(state === "resting" || state === "partial") && (
        <button type="button" className={btnDanger} onClick={cancel} disabled={cancelling}>{cancelling ? "Cancelling…" : v?.filled ? "Cancel the rest" : "Cancel order"}</button>
      )}
    </section>
  );
}
