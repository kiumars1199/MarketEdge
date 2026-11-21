"use client";
// /alerts (F-11 demo): rule list, rule editor dialog, Inbox tab, dev-only "Run now".
// /alerts?market=<id>&side=<i> opens the editor pre-filled for that market (the drawer's "Alert me").
// /alerts?filters=<screener query> offers "Current filters" as a view. /alerts?tab=inbox opens the inbox.
// #23/#64 (Marc, Nov 20): delivery is said plainly. The open tab checks every 2 minutes (bell + browser notification);
// email is the server cron (/api/alerts/run, daily on the current Vercel plan), paid plans only, never in demo.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { runAlertsNow } from "@/components/alerts/AlertRunner";
import { InboxList, markAllRead, useInbox } from "@/components/alerts/Inbox";
import { Dialog, NumberInput, PageTitle, Segmented, Switch, Tabs, btn, btnGhost, btnPrimary, card, input } from "@/components/kit";
import { KIND_LABEL } from "@/lib/alerts";
import { fetchMarket, fetchMarkets } from "@/lib/api";
import { ago, formatCount, price, ret } from "@/lib/format";
import { parse } from "@/lib/filters/url";
import { askPermission } from "@/lib/notify";
import { can as tierCan, useEntitlements } from "@/lib/entitlements";
import { currentMe } from "@/lib/me";
import { DEMO_MODE, getRepo, repoReady } from "@/lib/repo";
import { useCollection } from "@/lib/repo/hooks";
import type { AlertChannel, AlertRule } from "@/lib/repo/types";
import type { Market } from "@/lib/types";
import { allViews, viewById } from "@/lib/views";

const DEV = process.env.NODE_ENV !== "production";
const DEMO = DEMO_MODE;   // demo runs alerts in the tab; "Run now" is a local test aid
/** How alerts are delivered, said once (#23/#64). Email: the server check, once a day (vercel.json cron). */
export const TAB_TEXT = "While Kismet is open in a tab, rules check every 2 minutes and alerts land in the bell (and as browser notifications if you allow them).";
export const EMAIL_TEXT = "With email on, our servers also check once a day, even when Kismet is closed, and email you what's new. Anything already in your bell isn't emailed again.";

/** Which channels a rule uses, in words: "inbox", "inbox + browser + email". */
export function channelWords(channels: readonly AlertChannel[]): string {
  return ["inbox", ...(channels.includes("push") ? ["browser"] : []), ...(channels.includes("email") ? ["email"] : [])].join(" + ");
}

/** Turns one channel on or off and leaves the others as they are. */
export function toggleChannel(channels: readonly AlertChannel[], ch: AlertChannel, on: boolean): AlertChannel[] {
  const rest = channels.filter((c) => c !== ch);
  return on ? [...rest, ch] : rest;
}

/** True once the account's data has loaded (paid mode), so an empty list isn't shown before the rules arrive. */
function useRepoLoaded(): boolean {
  const [ready, setReady] = useState(DEMO);
  useEffect(() => {
    if (DEMO) return;
    let on = true;
    const done = () => { if (on) setReady(true); };
    void repoReady.then(done);
    const t = setTimeout(done, 8_000);   // a failed load: show what the browser has
    return () => { on = false; clearTimeout(t); };
  }, []);
  return ready;
}
type Draft = Omit<AlertRule, "id" | "created_at" | "last_fired_at"> & { id?: string; view_id: string };

/** Read at call time (the drawer's "Alert me" pre-fill runs before the plan may be known on first render). */
const emailNow = () => !DEMO && tierCan(currentMe()?.tier ?? "free", "alerts");
/** `email`: the plan gets email alerts, so a new rule starts with email on (one tap turns it off). */
const blank = (email = false): Draft => ({
  name: "", enabled: true, kind: "preset_match", query: null, market_id: null, side_index: null, threshold: 1,
  channels: email ? ["email"] : [], webhook_url: null, cooldown_minutes: 60, quiet_hours: null, view_id: "builtin:best",
});

function describe(r: AlertRule): string {
  const q = r.query as { _view_name?: string } | null;
  switch (r.kind) {
    case "preset_match": return `When a market newly matches “${q?._view_name ?? "a view"}”${(r.threshold ?? 1) > 1 ? ` · up to ${r.threshold} per check` : ""}`;
    case "market_price": return `When the price is ${price(r.threshold)} or lower`;
    case "edge_change": return `When estimated return crosses ${ret(r.threshold)}`;
    case "closing_soon": return `When ${r.market_id ? "this market" : "anything in My list"} closes within ${r.threshold ?? 6} h`;
  }
}

export function AlertsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rules = useCollection("alert_rules");
  const loaded = useRepoLoaded();
  const { can } = useEntitlements();
  const email = !DEMO && can("alerts");   // the server cron emails paid plans only
  const { events, unread } = useInbox();
  const [tab, setTab] = useState<"rules" | "inbox">(params.get("tab") === "inbox" ? "inbox" : "rules");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const filters = params.get("filters");

  // Drawer's "Alert me": pre-fill a price alert for that market once, then drop the params.
  useEffect(() => {
    const id = params.get("market");
    if (!id) return;
    const side = params.get("side") === "1" ? 1 : params.get("side") === "0" ? 0 : null;
    fetchMarket(id).then(({ market: m }) => {
      const s = m.sides[side ?? m.best.side_index] ?? m.best;
      setDraft({ ...blank(emailNow()), kind: "market_price", name: `${s.outcome} · ${m.question}`.slice(0, 80), market_id: m.id, side_index: s.side_index, threshold: Math.max(0.01, Math.round((s.ask - 0.02) * 100) / 100), view_id: "" });
    }, () => setDraft({ ...blank(emailNow()), kind: "market_price", market_id: id, side_index: side, threshold: null, view_id: "" }));
    const p = new URLSearchParams(params);
    p.delete("market"); p.delete("side");
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (r: AlertRule) => setDraft({ ...r, view_id: (r.query as { _view?: string } | null)?._view ?? "" });
  const runNow = async () => {
    setRunMsg("Checking…");
    const n = await runAlertsNow();
    setRunMsg(n ? `${n} new alert${n === 1 ? "" : "s"}.` : "No new alerts.");
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageTitle title="Alerts" sub={email ? `${TAB_TEXT} ${EMAIL_TEXT}` : TAB_TEXT}>
        {(DEV || DEMO) && <button type="button" className={btn} onClick={runNow} title="Demo and development only">Run now</button>}
        <button type="button" className={btnPrimary} onClick={() => setDraft({ ...blank(email), view_id: filters ? "current" : "builtin:best" })}>New alert</button>
      </PageTitle>
      {runMsg && <p role="status" className="-mt-3 text-sm text-muted">{runMsg}</p>}
      <Tabs label="Alerts" value={tab} onChange={setTab} tabs={[{ value: "rules", label: `Rules (${rules.length})` }, { value: "inbox", label: unread ? `Inbox (${formatCount(unread)} new)` : "Inbox" }]} />

      {tab === "rules" ? (
        !rules.length && !loaded ? (
          <div className={`${card} p-6 text-sm text-muted`} role="status" aria-busy="true">Loading your alerts…</div>
        ) : !rules.length ? (
          <div className={`${card} flex flex-col items-start gap-3 p-6`}>
            <h2 className="text-lg font-semibold">No alert rules yet</h2>
            <p className="max-w-xl text-sm text-muted">Get told when a market enters one of your views, when a price drops to your target, when estimated return moves past a level, or when a saved market is about to close.</p>
            <button type="button" className={btnPrimary} onClick={() => setDraft(blank(email))}>Create an alert</button>
          </div>
        ) : (
          <ul className={`${card} divide-y divide-border`}>
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <Switch label={`${r.name} enabled`} checked={r.enabled} onChange={(v) => void getRepo().alert_rules.update(r.id, { enabled: v })} />
                <div className="min-w-0 flex-1 basis-60">
                  <div className={`truncate font-medium ${r.enabled ? "" : "text-muted"}`}>{r.name}</div>
                  <div className="text-sm text-muted">{describe(r)}</div>
                  <div className="text-xs text-muted">{KIND_LABEL[r.kind]} · cooldown {r.cooldown_minutes} min · {channelWords(r.channels)}{r.last_fired_at ? ` · last alert ${ago(Date.parse(r.last_fired_at) / 1000)}` : ""}</div>
                </div>
                <div className="ml-auto flex gap-1">
                  <button type="button" className={btnGhost} onClick={() => edit(r)}>Edit</button>
                  <button type="button" className={btnGhost} onClick={() => confirm(`Delete the alert “${r.name}”?`) && void getRepo().alert_rules.remove(r.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <section aria-label="Inbox" className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm text-muted">Last {events.length} alert{events.length === 1 ? "" : "s"}</span>
            <button type="button" onClick={() => void markAllRead()} disabled={!unread} className="text-sm text-accent-hover hover:underline disabled:text-muted disabled:no-underline">Mark all read</button>
          </div>
          <InboxList events={events} />
        </section>
      )}
      <RuleEditor draft={draft} filters={filters} email={email} onClose={() => setDraft(null)} />
    </div>
  );
}

function MarketPicker({ marketId, onPick }: { marketId: string | null; onPick: (m: Market) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Market[]>([]);
  const [current, setCurrent] = useState<Market | null>(null);
  useEffect(() => {
    if (!marketId) { setCurrent(null); return; }
    if (current?.id === marketId) return;
    fetchMarket(marketId).then((r) => setCurrent(r.market), () => setCurrent(null));
  }, [marketId, current?.id]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => fetchMarkets({ q: q.trim(), group_by_event: false, page_size: 6, win_prob_floor_default: 0 }).then((r) => setFound(r.rows.map((x) => x.market)), () => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="flex flex-col gap-2">
      {current && <p className="rounded-input border border-accent-border bg-accent-bg px-3 py-2 text-sm text-accent-soft">{current.question}</p>}
      <input className={input} placeholder={current ? "Search to change market" : "Search a team, city or topic"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
      {found.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-input border border-border">
          {found.map((m) => (
            <li key={m.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => { onPick(m); setCurrent(m); setQ(""); setFound([]); }}>{m.question}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleEditor({ draft, filters, email, onClose }: { draft: Draft | null; filters: string | null; email: boolean; onClose: () => void }) {
  const presets = useCollection("presets");
  const [d, setD] = useState<Draft>(blank());
  const [sides, setSides] = useState<string[]>(["Yes", "No"]);
  useEffect(() => { if (draft) setD(draft); }, [draft]);
  useEffect(() => {
    if (d.market_id) fetchMarket(d.market_id).then((r) => setSides(r.market.sides.map((s) => s.outcome)), () => {});
  }, [d.market_id]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const views = [...(filters ? [{ id: "current", name: "Current filters" }] : []), ...allViews(presets)];
  const needsMarket = d.kind === "market_price" || d.kind === "edge_change";
  const valid = (d.kind === "preset_match" ? !!d.view_id : true) && (!needsMarket || (!!d.market_id && d.threshold != null)) && d.cooldown_minutes >= 1;

  const save = async () => {
    if (!valid) return;
    let query: AlertRule["query"] = null;
    let name = d.name.trim();
    if (d.kind === "preset_match") {
      const v = d.view_id === "current" ? { id: "current", name: "Current filters", state: parse(filters ?? "") } : viewById(d.view_id, presets);
      if (!v) return;
      query = { ...v.state, _view: v.id, _view_name: v.name };
      name ||= v.name;
    }
    name ||= KIND_LABEL[d.kind];
    const row = {
      name, enabled: d.enabled, kind: d.kind, query, market_id: d.kind === "preset_match" ? null : d.market_id,
      side_index: d.kind === "preset_match" ? null : d.side_index, threshold: d.threshold,
      channels: d.channels, webhook_url: null, cooldown_minutes: d.cooldown_minutes, quiet_hours: d.quiet_hours,
    };
    if (d.id) await getRepo().alert_rules.update(d.id, row);
    else await getRepo().alert_rules.insert({ ...row, last_fired_at: null });
    onClose();
  };

  const toggleBrowser = async (on: boolean) => {
    setD((x) => ({ ...x, channels: toggleChannel(x.channels, "push", on) }));
    if (on) await askPermission();   // only on this user action, never on page load
  };

  const kindDefaults: Record<AlertRule["kind"], Partial<Draft>> = {
    preset_match: { threshold: 1 }, market_price: { threshold: null }, edge_change: { threshold: 5 }, closing_soon: { threshold: 6 },
  };

  return (
    <Dialog open={draft !== null} onClose={onClose} title={d.id ? "Edit alert" : "New alert"}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Alert me when</span>
          <Segmented label="Alert kind" value={d.kind} onChange={(k) => set({ kind: k, ...kindDefaults[k] })}
            options={(Object.keys(KIND_LABEL) as AlertRule["kind"][]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </div>

        {d.kind === "preset_match" && (
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              View
              <select className={input} value={d.view_id} onChange={(e) => set({ view_id: e.target.value })}>
                {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1.5 text-xs font-medium text-muted sm:w-32">
              Max per check
              <NumberInput ariaLabel="Max alerts per check" value={d.threshold} onChange={(v) => set({ threshold: v === null ? null : Math.min(10, Math.max(1, Math.round(v))) })} min={1} max={10} step="1" />
            </label>
          </div>
        )}

        {d.kind !== "preset_match" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">{d.kind === "closing_soon" ? "Market (leave empty for everything in My list)" : "Market"}</span>
            <MarketPicker marketId={d.market_id} onPick={(m) => set({ market_id: m.id, side_index: m.best.side_index, name: d.name || m.question.slice(0, 80) })} />
            {d.market_id && (
              <Segmented label="Side" value={String(d.side_index ?? 0)} onChange={(v) => set({ side_index: v === "1" ? 1 : 0 })}
                options={sides.map((s, i) => ({ value: String(i), label: s }))} />
            )}
          </div>
        )}

        {d.kind === "market_price" && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Price at or below
            <NumberInput ariaLabel="Target price, as a percent" value={d.threshold === null ? null : +(d.threshold * 100).toFixed(1)} onChange={(v) => set({ threshold: v === null ? null : Math.min(0.99, Math.max(0.01, v / 100)) })} suffix="%" min={1} max={99} />
          </label>
        )}
        {d.kind === "edge_change" && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Estimated return crosses (up or down)
            <NumberInput ariaLabel="Estimated return level in percent" value={d.threshold} onChange={(v) => set({ threshold: v })} suffix="%" />
          </label>
        )}
        {d.kind === "closing_soon" && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Within (hours)
            <NumberInput ariaLabel="Hours before close" value={d.threshold} onChange={(v) => set({ threshold: v === null ? null : Math.max(1, v) })} min={1} step="1" />
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Name
            <input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="Named after the view or market" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Quiet for (minutes after an alert)
            <NumberInput ariaLabel="Cooldown in minutes" value={d.cooldown_minutes} onChange={(v) => set({ cooldown_minutes: Math.max(1, Math.round(v ?? 60)) })} min={1} step="1" />
          </label>
        </div>

        <div className="flex flex-col gap-3 rounded-inner border border-border p-3">
          <div className="flex items-center justify-between gap-3 text-sm"><span>In-app inbox (bell)</span><span className="text-muted">Always on</span></div>
          <div className="flex items-center justify-between gap-3 text-sm"><span>Browser notification<span className="block text-xs text-muted">While Kismet is open in a tab</span></span><Switch label="Browser notification" checked={d.channels.includes("push")} onChange={toggleBrowser} /></div>
          {email && <div className="flex items-center justify-between gap-3 text-sm"><span>Email<span className="block text-xs text-muted">Checked once a day, even when Kismet is closed</span></span><Switch label="Email" checked={d.channels.includes("email")} onChange={(v) => setD((x) => ({ ...x, channels: toggleChannel(x.channels, "email", v) }))} /></div>}
          <div className="flex items-center justify-between gap-3 text-sm"><span>Rule on</span><Switch label="Rule on" checked={d.enabled} onChange={(v) => set({ enabled: v })} /></div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={!valid}>{d.id ? "Save" : "Create alert"}</button>
        </div>
      </form>
    </Dialog>
  );
}
