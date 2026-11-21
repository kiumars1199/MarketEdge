"use client";
// /journal "My bets" (T-37, docs/05 F-12): tiles, charts, table, CSV, edit/delete, settlement on load.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dialog, NumberInput, Segmented, Stat, btn, btnDanger, btnGhost, btnPrimary, card, input } from "@/components/kit";
import { drawerHref } from "@/components/market/drawer";
import { DASH, edge, formatCount, money, pct, price, ret, RETURN_HELP } from "@/lib/format";
import { byTopic, clv, cumulative, day, entryReturn, fromCsv, pnl, settlePatch, stake, summarize, toCsv, type Result, type Settlement } from "@/lib/journal";
import { useOdds } from "@/lib/odds";
import { getRepo } from "@/lib/repo";
import { useCollection, useProfile } from "@/lib/repo/hooks";
import type { JournalEntry } from "@/lib/repo/types";

const tone = (x: number | null) => (x === null || Math.abs(x) < 1e-9 ? undefined : x > 0 ? "pos" : "neg") as "pos" | "neg" | undefined;

/** POST /api/settle for open rows (and rows missing a closing price), then patch them in the repo. */
function useSettlement(rows: JournalEntry[]) {
  const [state, setState] = useState<"idle" | "checking" | "done" | "error">("idle");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !rows.length) return;
    const ids = [...new Set(rows.filter((r) => r.result === null || r.closing_price === null).map((r) => r.market_id))];
    ran.current = true;
    if (!ids.length) return;
    setState("checking");
    fetch("/api/settle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, Settlement>>) : Promise.reject()))
      .then(async (res) => {
        for (const row of rows) {
          const p = settlePatch(row, res[row.market_id]);
          if (p) await getRepo().journal.update(row.id, p);
        }
        setState("done");
      })
      .catch(() => setState("error"));
  }, [rows]);
  return state;
}

export function JournalView() {
  const rows = useCollection("journal");
  const profile = useProfile();
  const pro = profile.numbers_mode === "pro";
  const settle = useSettlement(rows);
  const s = useMemo(() => summarize(rows), [rows]);
  const sorted = useMemo(() => [...rows].sort((a, b) => b.placed_at.localeCompare(a.placed_at)), [rows]);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const clvRel = useMemo(() => {
    const xs = rows.filter((r) => r.closing_price !== null && r.price > 0).map((r) => (clv(r)! / r.price) * 100);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }, [rows]);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(sorted)], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `my-bets-${new Date().toISOString().slice(0, 10)}.csv` }).click();
    URL.revokeObjectURL(url);
  };
  const importCsv = async (file: File) => {
    const { rows: add, skipped } = fromCsv(await file.text());
    for (const r of add) await getRepo().journal.insert(r);
    setMsg(`Imported ${formatCount(add.length)} bet${add.length === 1 ? "" : "s"}${skipped ? `, skipped ${formatCount(skipped)} row${skipped === 1 ? "" : "s"} missing market, side, price or shares` : ""}.`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        <label className={`${btn} cursor-pointer`}>
          Import CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }} />
        </label>
        <span className="text-sm text-muted" role="status" aria-live="polite">
          {msg ?? (settle === "checking" ? "Checking results on Polymarket…" : settle === "error" ? "Couldn't reach Polymarket to check results. They'll update next visit." : "")}
        </span>
      </div>

      {!rows.length ? (
        <div className={`${card} flex flex-col items-start gap-3 p-6`}>
          <h2 className="text-lg font-semibold">No bets logged yet</h2>
          <p className="max-w-xl text-sm text-muted">Open any market and use <span className="text-text">Log this bet</span> after you place it on Polymarket. Results settle automatically when the market resolves, and your profit, return and closing-price record show up here.</p>
          <Link href="/" className={btnPrimary}>Browse Best bets</Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="Bets" value={s.open ? `${formatCount(s.bets)} · ${formatCount(s.open)} open` : formatCount(s.bets)} />
            <Stat label="Staked" value={money(s.staked)} />
            <Stat label="Profit / loss" value={s.settled ? money(s.pnl, true) : DASH} tone={tone(s.pnl)} title="Settled bets only" />
            <Stat label="Return (ROI)" value={ret(s.roi)} tone={tone(s.roi)} title="Profit ÷ money staked on settled bets" />
            <Stat label="Win rate" value={pct(s.win_rate)} title="Won ÷ (won + lost); voids excluded" />
            <Stat label="Vs closing price" value={pro ? edge(s.avg_clv) : ret(clvRel)} tone={tone(s.avg_clv)}
              title="Average of (closing price − your price). Beating the closing price over many bets is the best early sign your bets are well priced." />
            <Stat label="Estimated return at entry" value={ret(s.avg_entry_return)} tone="accent" title={RETURN_HELP} />
          </div>
          <Charts rows={rows} />
          <BetTable rows={sorted} tz={profile.timezone} pro={pro} onEdit={setEditing} />
        </>
      )}
      <EditDialog row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }, labelStyle: { color: "var(--muted)" } };

function Charts({ rows }: { rows: JournalEntry[] }) {
  const series = useMemo(() => cumulative(rows), [rows]);
  const topics = useMemo(() => byTopic(rows), [rows]);
  if (!series.length) {
    return <p className={`${card} p-5 text-sm text-muted`}>Charts appear once a bet settles. Open bets settle when Polymarket resolves the market.</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <figure className={`${card} p-5`}>
        <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">Profit over time</span>
          <span className="flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 bg-accent" />Actual</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-0 w-4 border-t-2 border-dashed border-market-bar" />Estimated at entry</span>
          </span>
        </figcaption>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="n" {...axis} tickFormatter={(n) => `#${n}`} />
              <YAxis {...axis} width={56} tickFormatter={(v: number) => money(v)} />
              <Tooltip {...tip} labelFormatter={(n) => `After bet #${n}`} formatter={(v, k) => [money(Number(v), true), k === "pnl" ? "Actual" : "Estimated at entry"]} />
              <Line type="linear" dataKey="expected" stroke="var(--market-bar)" strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="linear" dataKey="pnl" stroke="var(--accent)" strokeWidth={2.5} dot={series.length < 30} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className={`${card} p-5`}>
        <figcaption className="font-semibold">Profit by topic</figcaption>
        <div className="mt-3" style={{ height: Math.max(120, topics.length * 34 + 24) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topics} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <XAxis type="number" {...axis} tickFormatter={(v: number) => money(v)} />
              <YAxis type="category" dataKey="topic" {...axis} width={80} tickFormatter={(t: string) => t.toUpperCase()} />
              <Tooltip {...tip} cursor={{ fill: "var(--muted-bg)" }} formatter={(v) => [money(Number(v), true), "Profit"]} />
              <Bar dataKey="pnl" radius={4} isAnimationActive={false}>
                {topics.map((t) => <Cell key={t.topic} fill={t.pnl >= 0 ? "var(--positive)" : "var(--negative)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}

const RESULT_TEXT: Record<Result | "open", string> = { won: "Won", lost: "Lost", void: "Void · refunded", open: "Open" };

function BetTable({ rows, tz, pro, onEdit }: { rows: JournalEntry[]; tz: string; pro: boolean; onEdit: (r: JournalEntry) => void }) {
  const odds = useOdds();
  const remove = (r: JournalEntry) => { if (confirm(`Delete this bet on “${r.question ?? r.market_id}”?`)) void getRepo().journal.remove(r.id); };
  const result = (r: JournalEntry) => (
    <span className={r.result === "won" ? "text-positive" : r.result === "lost" ? "text-negative" : "text-muted"}>{RESULT_TEXT[r.result ?? "open"]}</span>
  );
  const actions = (r: JournalEntry) => (
    <span className="flex justify-end gap-1">
      <button type="button" className={btnGhost} onClick={() => onEdit(r)} aria-label={`Edit bet on ${r.question ?? r.market_id}`}>Edit</button>
      <button type="button" className={btnGhost} onClick={() => remove(r)} aria-label={`Delete bet on ${r.question ?? r.market_id}`}>Delete</button>
    </span>
  );
  const market = (r: JournalEntry) => (
    <Link href={`/journal${drawerHref(r.market_id, r.side_index)}`} scroll={false} className="hover:text-accent-hover">
      <span className="line-clamp-2 font-medium">{r.question ?? r.market_id}</span>
      <span className="text-xs text-muted">{r.outcome ?? `Side ${r.side_index + 1}`}{r.niche ? ` · ${r.niche.toUpperCase()}` : ""}</span>
    </Link>
  );
  return (
    <section aria-label="Bets" className={`${card} overflow-hidden`}>
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-border text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Placed</th><th className="px-4 py-3 font-medium">Bet</th>
            <th className="px-4 py-3 text-right font-medium">Price</th><th className="px-4 py-3 text-right font-medium">Staked</th>
            <th className="px-4 py-3 text-right font-medium" title={RETURN_HELP}>Estimated return</th>
            <th className="px-4 py-3 text-right font-medium">Closing price</th><th className="px-4 py-3 font-medium">Result</th>
            <th className="px-4 py-3 text-right font-medium">P&amp;L</th><th className="px-2 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="align-top hover:bg-raised">
              <td className="whitespace-nowrap px-4 py-3 text-muted">{day(r.placed_at, tz)}</td>
              <td className="max-w-[360px] px-4 py-3">{market(r)}</td>
              <td className="px-4 py-3 text-right">{odds(r.price)}</td>
              <td className="px-4 py-3 text-right">{money(stake(r))}</td>
              <td className={`px-4 py-3 text-right ${(r.model_edge ?? 0) > 0 ? "text-accent" : "text-muted"}`}>{pro ? edge(r.model_edge) : ret(entryReturn(r))}</td>
              <td className="px-4 py-3 text-right">{r.closing_price === null ? DASH : <>{price(r.closing_price)}{pro && <span className="ml-1 text-xs text-muted">({edge(clv(r))})</span>}</>}</td>
              <td className="px-4 py-3">{result(r)}</td>
              <td className={`px-4 py-3 text-right font-medium ${r.pnl_usd === null ? "text-muted" : r.pnl_usd > 0 ? "text-positive" : r.pnl_usd < 0 ? "text-negative" : ""}`}>{r.pnl_usd === null ? DASH : money(r.pnl_usd, true)}</td>
              <td className="px-2 py-1.5">{actions(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 p-4">
            {market(r)}
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-muted">{day(r.placed_at, tz)} · {odds(r.price)} · {money(stake(r))}</span>
              <span>{result(r)} <span className={`font-medium ${r.pnl_usd !== null && r.pnl_usd > 0 ? "text-positive" : r.pnl_usd !== null && r.pnl_usd < 0 ? "text-negative" : "text-muted"}`}>{r.pnl_usd === null ? "" : money(r.pnl_usd, true)}</span></span>
            </div>
            <div className="-mx-3 -mb-2">{actions(r)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EditDialog({ row, onClose }: { row: JournalEntry | null; onClose: () => void }) {
  const [cents, setCents] = useState<number | null>(null);
  const [shares, setShares] = useState<number | null>(null);
  const [result, setResult] = useState<Result | "open">("open");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!row) return;
    setCents(+(row.price * 100).toFixed(2)); setShares(+row.shares.toFixed(4)); setResult(row.result ?? "open"); setNote(row.note ?? "");
  }, [row]);
  const p = cents === null ? NaN : cents / 100;
  const valid = p > 0 && p < 1 && shares !== null && shares > 0;
  const save = async () => {
    if (!row || !valid) return;
    const fee = row.price > 0 && row.price < 1 ? (row.fee / (row.price * (1 - row.price))) * p * (1 - p) : row.fee; // same fee rate, new price
    const base = { price: p, shares, fee };
    const r = result === "open" ? null : result;
    await getRepo().journal.update(row.id, {
      ...base, note: note.trim() || null, result: r, pnl_usd: r ? pnl(base, r) : null,
      settled_at: r ? (row.settled_at ?? new Date().toISOString()) : null,
      model_edge: row.model_win_prob === null ? row.model_edge : row.model_win_prob - p - fee,
    });
    onClose();
  };
  return (
    <Dialog open={row !== null} onClose={onClose} title="Edit bet">
      {row && (
        <>
          <p className="text-sm text-muted">{row.question} · {row.outcome}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">Price paid<NumberInput value={cents} onChange={setCents} suffix="%" ariaLabel="Price paid, as a percent" /></label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">Shares<NumberInput value={shares} onChange={setShares} ariaLabel="Shares" /></label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Result</span>
            <Segmented label="Result" value={result} onChange={setResult}
              options={[{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "void", label: "Void" }]} />
          </div>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">Note<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={input} /></label>
          <div className="flex justify-between gap-2">
            <button type="button" className={btnDanger} onClick={() => { void getRepo().journal.remove(row.id); onClose(); }}>Delete</button>
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={onClose}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={save} disabled={!valid}>Save</button>
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
