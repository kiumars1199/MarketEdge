"use client";
// /settings (T-34, docs/05 F-17, F-13, F-21): display, sizing, topics, notifications, data.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NumberInput, Segmented, Switch, btn, btnDanger, card, input } from "@/components/kit";
import { TopicsPicker } from "@/components/settings/TopicsPicker";
import { money } from "@/lib/format";
import { askPermission, browserAlertsOn, notifyState, setBrowserAlerts, type NotifyState } from "@/lib/notify";
import { ODDS_CHOICES, ODDS_LABEL, formatOdds } from "@/lib/odds";
import Link from "next/link";
import { getRepo } from "@/lib/repo";
import { accountsOn, savedWhere } from "@/lib/saved-where";
import { useProfile } from "@/lib/repo/hooks";
import type { CollectionName, Profile } from "@/lib/repo/types";

const patch = (p: Partial<Profile>) => void getRepo().profile.patch(p);
const COLLECTIONS: CollectionName[] = ["presets", "dashboards", "watchlist", "alert_rules", "alert_events", "journal"];
const KELLY = [0.1, 0.25, 0.5, 1] as const;
const kellyName = (f: number) => (f === 1 ? "Full" : f === 0.5 ? "Half" : f === 0.25 ? "Quarter" : `${Math.round(f * 100)}%`);

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${card} p-5 md:p-6`}>
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      <div className="mt-4 flex flex-col divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="max-w-md">
        <div className="font-medium">{title}</div>
        {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
      </div>
      <div className="md:flex-none">{children}</div>
    </div>
  );
}

export function SettingsForm() {
  const profile = useProfile();
  const zones = useMemo(() => {
    try { return Intl.supportedValuesOf("timeZone"); } catch { return [profile.timezone]; }
  }, [profile.timezone]);

  return (
    <div className="flex flex-col gap-5">
      <Section id="s-display" title="Display">
        <Row title="Odds format" sub={`How prices show where pages support it. Example: ${formatOdds(0.68, profile.odds_format)}`}>
          <Segmented
            label="Odds format" value={profile.odds_format === "cents" ? "percent" : profile.odds_format} onChange={(v) => patch({ odds_format: v })}
            options={ODDS_CHOICES.map((v) => ({ value: v, label: ODDS_LABEL[v] }))}
          />
        </Row>
        <Row title="Show numbers as" sub="Simple shows estimated return. Pro adds edge in percentage points.">
          <Segmented label="Show numbers as" value={profile.numbers_mode} onChange={(v) => patch({ numbers_mode: v })}
            options={[{ value: "simple", label: "Simple" }, { value: "pro", label: "Pro (edge in points)" }]} />
        </Row>
        <Row title="Theme">
          <Segmented label="Theme" value={profile.theme} onChange={(v) => patch({ theme: v })}
            options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        </Row>
        <Row title="Density" sub="Compact fits more rows on screen.">
          <Segmented label="Density" value={profile.density} onChange={(v) => patch({ density: v })}
            options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        </Row>
        <Row title="Time zone" sub="Used for closing times and the dates in My bets.">
          <select aria-label="Time zone" value={profile.timezone} onChange={(e) => patch({ timezone: e.target.value })} className={`${input} md:w-72`}>
            {zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}
          </select>
        </Row>
      </Section>

      <Section id="s-sizing" title="Sizing" sub="Used by the sizing card in the market drawer. This is math on your own numbers, not advice.">
        <Row title="Bankroll" sub={savedWhere().bankroll}>
          <div className="md:w-48">
            <NumberInput ariaLabel="Bankroll in dollars" prefix="$" min={0} step="1" value={profile.bankroll_usd}
              onChange={(v) => patch({ bankroll_usd: v !== null && v >= 0 ? v : null })} placeholder="e.g. 1000" />
          </div>
        </Row>
        <Row title="Kelly fraction" sub="Share of the full Kelly stake to use. Quarter is a common, cautious choice.">
          <Segmented label="Kelly fraction" value={String(profile.kelly_fraction)}
            onChange={(v) => patch({ kelly_fraction: Number(v) })}
            options={KELLY.map((f) => ({ value: String(f), label: kellyName(f) }))} />
        </Row>
        <Row title="Default stake" sub={`Pre-filled when you log a bet. Now ${money(profile.default_stake_usd)}.`}>
          <div className="md:w-48">
            <NumberInput ariaLabel="Default stake in dollars" prefix="$" min={1} step="1" value={profile.default_stake_usd}
              onChange={(v) => v !== null && v > 0 && patch({ default_stake_usd: v })} />
          </div>
        </Row>
      </Section>

      <Section id="s-topics" title="Topics" sub="Favorite topics pin chips on the screener. Chosen by you, never from your bets.">
        <div className="pt-0"><TopicsPicker /></div>
        {profile.favorite_topics.length > 0 && (
          <p className="pt-3 text-sm text-muted">Favorites: {profile.favorite_topics.join(", ")}</p>
        )}
      </Section>

      <Notifications />
      <DataSection />
    </div>
  );
}

const STATE_TEXT: Record<NotifyState, string> = {
  unsupported: "This browser doesn't support notifications.",
  default: "The browser will ask for permission when you turn this on.",
  granted: "Permission granted.",
  denied: "Blocked in your browser settings. Allow notifications for this site to use them.",
};

function Notifications() {
  const [state, setState] = useState<NotifyState>("unsupported");
  const [on, setOn] = useState(true);
  useEffect(() => { setState(notifyState()); setOn(browserAlertsOn()); }, []);
  const toggle = async (v: boolean) => {
    setBrowserAlerts(v);
    setOn(v);
    if (v) setState(await askPermission());
  };
  return (
    <Section id="s-notify" title="Notifications" sub="Alerts always land in the bell inbox. Browser notifications show while Kismet is open in a tab.">
      <Row title="Browser notifications" sub={STATE_TEXT[state]}>
        <Switch label="Browser notifications" checked={on && state === "granted"} onChange={toggle} />
      </Row>
    </Section>
  );
}

function DataSection() {
  const [cleared, setCleared] = useState(false);
  const exportAll = async () => {
    const repo = getRepo();
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), profile: await repo.profile.get() };
    for (const c of COLLECTIONS) out[c] = await repo[c].list();
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `kismet-data-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const clear = () => {
    if (!confirm("Delete everything Kismet saved on this device: settings, saved views, My list, My bets, alerts and dashboards? This can't be undone.")) return;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("me:v1:")) localStorage.removeItem(k);
    } catch { /* storage blocked */ }
    setCleared(true);
    location.reload();
  };
  return (
    <Section id="s-data" title="Your data" sub={savedWhere().data}>
      <Row title="Export" sub="Download all your settings, saves, bets and alerts as one JSON file.">
        <button type="button" className={btn} onClick={exportAll}>Export my data</button>
      </Row>
      {/* #22: signed in, the data is in the account; clearing this browser would delete nothing, so point to /account */}
      {accountsOn() ? (
        <Row title="Delete your data" sub="Deleting your account removes your settings, saved views, My list, My bets and alerts.">
          <Link href="/account" className={btn}>Go to Account</Link>
        </Row>
      ) : (
        <Row title="Clear local data" sub="Removes everything above from this browser.">
          <button type="button" className={btnDanger} onClick={clear} disabled={cleared}>Clear local data</button>
        </Row>
      )}
    </Section>
  );
}

