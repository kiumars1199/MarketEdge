"use client";
// My list (docs/05 F-09): saved markets with today's numbers, "since saved", status, note + target price
// (target price = a market_price alert rule), bulk remove. Rows open the market drawer.
import { ClosesLine } from "@/components/clock";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { drawerHref } from "@/components/market/drawer";
import { fetchMarket, type StoreMarket } from "@/lib/api";
import { DASH, betLine, formatCount, pct, price, ret } from "@/lib/format";
import { getRepo, type WatchlistItem } from "@/lib/repo";
import { useCollection } from "@/lib/repo/hooks";
import { WatchStar, type WatchSnapshot } from "./WatchStar";
import { sideChance } from "@/lib/betFigures";

type Live = StoreMarket | "gone" | undefined; // undefined = loading
const SOON_H = 24;

function status(m: Live, snap: WatchSnapshot | null): { label: string; tone: string } {
  const closesAt = m && m !== "gone" ? m.closes_at : snap?.closes_at;
  if (m === "gone" || (closesAt !== undefined && closesAt * 1000 <= Date.now())) return { label: "Closed", tone: "text-muted bg-muted-bg" };
  if (closesAt !== undefined && closesAt * 1000 - Date.now() < SOON_H * 3600e3) return { label: "Closing soon", tone: "text-warning bg-muted-bg" };
  return { label: "Open", tone: "text-accent-soft bg-accent-bg" };
}

/** "price 68→71%, estimated return +33%→+24%" */
function since(snap: WatchSnapshot, ask: number, roi: number): string {
  const p0 = price(snap.ask), p1 = price(ask), r0 = ret(snap.roi_pct), r1 = ret(roi);
  if (p0 === p1 && r0 === r1) return "No change since saved";
  return `Since saved: price ${p0.replace("%", "")}→${p1}, estimated return ${r0}→${r1}`;
}

async function setTarget(item: WatchlistItem, cents: number | null, question: string, sideIndex: 0 | 1) {
  const repo = getRepo();
  const threshold = cents === null ? null : cents / 100;
  await repo.watchlist.update(item.id, { target_price: threshold });
  const rule = (await repo.alert_rules.list()).find((r) => r.kind === "market_price" && r.market_id === item.market_id && r.side_index === sideIndex);
  if (threshold === null) return rule && repo.alert_rules.remove(rule.id);
  const name = `${question}: price at ${price(threshold)} or lower`;
  if (rule) return repo.alert_rules.update(rule.id, { threshold, name, enabled: true });
  await repo.alert_rules.insert({
    kind: "market_price", market_id: item.market_id, side_index: sideIndex, threshold, enabled: true, name,
    // in-app inbox channel; AlertChannel lists only external channels so far
    channels: ["inapp"], query: null, webhook_url: null, cooldown_minutes: 60, quiet_hours: null, last_fired_at: null,
  });
}

function Row({ item, live, selected, onSelect }: { item: WatchlistItem; live: Live; selected: boolean; onSelect: (on: boolean) => void }) {
  const params = useSearchParams();
  const snap = item.snapshot as WatchSnapshot | null;
  const m = live && live !== "gone" ? live : null;
  const sideIndex = (item.side_index ?? snap?.saved_side ?? m?.best.side_index ?? 0) as 0 | 1;
  const s = m ? m.sides[sideIndex] ?? m.best : null;
  const question = m?.question ?? snap?.question ?? "Market no longer listed";
  const st = status(live, snap);
  const label = s ? sideChance(s) : null;
  const [note, setNote] = useState(item.note ?? "");
  const [target, setTargetText] = useState(item.target_price === null ? "" : String(Math.round(item.target_price * 100)));

  const saveTarget = () => {
    const n = target.trim() === "" ? null : Number(target);
    if (n !== null && !(n >= 1 && n <= 99)) return setTargetText(item.target_price === null ? "" : String(Math.round(item.target_price * 100)));
    if ((n === null ? null : n / 100) !== item.target_price) setTarget(item, n === null ? null : Math.round(n), question, sideIndex);
  };

  return (
    <li data-row data-market-id={item.market_id} className="rounded-card border border-border bg-surface p-4 focus-within:border-accent-border md:p-5">
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${question}`}
          className="mt-1 size-4 flex-none accent-[var(--accent)]" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <Link href={drawerHref(item.market_id, item.side_index ?? undefined, params)} scroll={false} className="font-semibold leading-snug hover:text-accent-hover">
                {question}
              </Link>
              <p className="mt-1 text-sm text-muted">
                {s ? betLine(s) : snap?.outcome ? `Saved: ${snap.outcome}` : DASH}
                {label && <> · {label}</>}
                {m && <> · <ClosesLine at={m.closes_at} /></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-xs ${st.tone}`}>{st.label}</span>
              <WatchStar marketId={item.market_id} side={item.side_index ?? undefined} />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">Estimated return</div>
              <div className="font-heading text-2xl font-bold tabular-nums text-accent">{live === undefined ? "…" : ret(s?.roi_pct)}</div>
            </div>
            <dl className="flex gap-6 text-sm tabular-nums">
              <div><dt className="text-xs text-muted">Market says</dt><dd>{pct(s?.ask)}</dd></div>
              <div><dt className="text-xs text-muted">Won before</dt><dd className="text-accent-soft">{pct(s?.win_prob)}</dd></div>
            </dl>
            {snap && s && <p className="text-sm text-soft">{since(snap, s.ask, s.roi_pct)}</p>}
          </div>

          <div className="flex flex-wrap gap-3 border-t border-border pt-3">
            <label className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-sm text-muted">
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Why you saved it"
                onBlur={() => (note.trim() || null) !== item.note && getRepo().watchlist.update(item.id, { note: note.trim() || null })}
                className="min-w-0 flex-1 rounded-input border border-border bg-input px-3 py-2 text-text placeholder:text-muted focus:border-accent focus:outline-none" />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              Alert me at
              <span className="flex items-center rounded-input border border-border bg-input pr-3 focus-within:border-accent">
                <input inputMode="numeric" value={target} onChange={(e) => setTargetText(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  onBlur={saveTarget} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  placeholder="—" aria-describedby={`t-${item.id}`}
                  className="w-12 bg-transparent px-3 py-2 text-right text-text tabular-nums placeholder:text-muted focus:outline-none" />
                <span aria-hidden="true">%</span>
              </span>
              <span id={`t-${item.id}`} className="sr-only">Target price in cents, 1 to 99. We alert you when the price drops to it.</span>
              {item.target_price !== null && <span className="text-xs text-accent-softer" aria-live="polite">Alert on</span>}
            </label>
          </div>
        </div>
      </div>
    </li>
  );
}

export function MyList() {
  const items = useCollection("watchlist");
  const sorted = useMemo(() => [...items].sort((a, b) => b.created_at.localeCompare(a.created_at)), [items]);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = [...new Set(items.map((i) => i.market_id))].sort().join(",");

  useEffect(() => {
    if (!ids) return;
    const ac = new AbortController();
    for (const id of ids.split(",")) {
      fetchMarket(id, { signal: ac.signal }).then(
        (r) => setLive((l) => ({ ...l, [id]: r.market })),
        () => !ac.signal.aborted && setLive((l) => ({ ...l, [id]: "gone" })),
      );
    }
    return () => ac.abort();
  }, [ids]);

  const chosen = sorted.filter((i) => selected.has(i.id));
  const removeSelected = async () => {
    const repo = getRepo();
    for (const i of chosen) await repo.watchlist.remove(i.id);
    setSelected(new Set());
  };

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">My list</h1>
          <p className="mt-2 text-muted">{items.length ? `${formatCount(items.length)} saved. Numbers update with every scan.` : "Markets you saved, and how they moved since."}</p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-muted">
              <input type="checkbox" className="size-4 accent-[var(--accent)]"
                checked={chosen.length === items.length} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
              Select all
            </label>
            <button type="button" onClick={removeSelected} disabled={!chosen.length}
              className="rounded-input border border-border px-3.5 py-2 text-soft hover:border-negative hover:text-negative disabled:opacity-40 disabled:hover:border-border disabled:hover:text-soft">
              Remove{chosen.length ? ` ${formatCount(chosen.length)}` : ""}
            </button>
          </div>
        )}
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-card border border-dashed border-border p-8">
          <h2 className="text-xl font-semibold">Nothing saved yet</h2>
          <p className="max-w-prose text-muted">
            Tap the star on any bet to save it here. We keep the price and estimated return from the moment you saved it, so you can see how it moved, and you can set a price to be alerted at.
          </p>
          <Link href="/" className="inline-flex min-h-11 items-center rounded-input bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover">See best bets</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((i) => (
            <Row key={i.id} item={i} live={live[i.market_id]} selected={selected.has(i.id)}
              onSelect={(on) => setSelected((s) => { const n = new Set(s); if (on) n.add(i.id); else n.delete(i.id); return n; })} />
          ))}
        </ul>
      )}
    </section>
  );
}
