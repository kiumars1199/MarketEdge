"use client";
// "My Kalshi" inside My bets (docs/16 §3 Portfolio view): demo balance, resting orders, open positions, read
// through the extension. Display only: Kismet never ranks or suggests bets from these positions.
// On load it also brings fills of orders placed here into My bets (one pass, read-only).
import { useEffect, useState } from "react";
import { card } from "@/components/kit";
import { money } from "@/lib/format";
import { getRepo } from "@/lib/repo";
import { ext, useTradeConfig } from "@/lib/trade/ext";
import { markFinal, recordFills, trackedOrders, type OrderView } from "@/lib/trade/fills";

interface Portfolio { balanceCents: number; resting: OrderView[]; positions: { ticker: string; position: number; pnl_cents: number }[] }

export function KalshiPanel() {
  const cfg = useTradeConfig();
  const [p, setP] = useState<Portfolio | null | string>(null);

  useEffect(() => {
    if (!cfg) return;
    let live = true;
    (async () => {
      const r = await ext<Portfolio>(cfg.extensionId, { type: "portfolio" });
      if (!live) return;
      setP(r.ok ? r : r.missing ? "Install the Kismet extension and connect a Kalshi demo key to see your paper account here." : r.error);
      if (!r.ok) return;
      for (const t of trackedOrders().filter((x) => !x.final)) {
        const o = await ext<{ order: OrderView | null }>(cfg.extensionId, { type: "order", order_id: t.order_id });
        if (!o.ok || !o.order) continue;
        await recordFills(getRepo(), t, o.order);
        if (o.order.state === "filled" || o.order.state === "cancelled") markFinal(t.order_id);
      }
    })();
    return () => { live = false; };
  }, [cfg]);

  if (!cfg) return null;
  return (
    <section aria-labelledby="kalshi-h" className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="kalshi-h" className="text-lg font-semibold">My Kalshi</h2>
        <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">Paper mode · demo exchange</span>
      </div>
      {p === null ? (
        <p className="text-sm text-muted" aria-live="polite">Reading your demo account through the extension…</p>
      ) : typeof p === "string" ? (
        <p className="text-sm text-muted">{p}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs text-muted">Demo balance</div>
            <div className="font-heading text-[26px] font-bold tabular-nums">{money(p.balanceCents / 100)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Waiting on the book</div>
            {p.resting.length ? (
              <ul className="mt-1 flex flex-col gap-1 text-sm tabular-nums">
                {p.resting.map((o) => <li key={o.order_id}><span className="font-mono text-xs">{o.ticker}</span> · {o.side === "yes" ? "Yes" : "No"} · {o.remaining} left</li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">None</p>}
          </div>
          <div>
            <div className="text-xs text-muted">Open positions</div>
            {p.positions.length ? (
              <ul className="mt-1 flex flex-col gap-1 text-sm tabular-nums">
                {p.positions.map((x) => <li key={x.ticker}><span className="font-mono text-xs">{x.ticker}</span> · {Math.abs(x.position)} {x.position > 0 ? "Yes" : "No"}</li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">None</p>}
          </div>
        </div>
      )}
    </section>
  );
}
