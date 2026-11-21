"use client";
// After load (paid mode only): ask /api/me who this is, switch My data to the account (SupabaseRepo),
// offer the one-time import of this browser's data (docs/08), and show the dev-only billing banner.
import { useEffect, useState } from "react";
import { Dialog, btn, btnPrimary } from "@/components/kit";
import { loadMe, useMe } from "@/lib/me";
import { DEMO_MODE, getLocalRepo, setRepo, type CollectionName, type Repo } from "@/lib/repo";
import { SupabaseRepo } from "@/lib/repo/supabase";

const NAMES: CollectionName[] = ["presets", "dashboards", "watchlist", "alert_rules", "alert_events", "journal"];
const askedKey = (uid: string) => `me:v1:import_asked:${uid}`;

/** Signed-out visitors only reach public pages (T-276); saving anything there sends them to sign up. */
function guestRepo(local: Repo): Repo {
  const toLogin = () => {
    window.location.assign(`/signup?next=${encodeURIComponent(location.pathname + location.search)}`);
    return Promise.reject(new Error("Sign in to save"));
  };
  return new Proxy(local, {
    get(target, key) {
      const v = (target as unknown as Record<PropertyKey, unknown>)[key];
      if (typeof key === "string" && (NAMES as string[]).includes(key)) return { ...(v as object), insert: toLogin };
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

function summary(counts: Partial<Record<CollectionName, number>>) {
  const words: [CollectionName, string, string][] = [
    ["presets", "saved view", "saved views"], ["watchlist", "market in My list", "markets in My list"],
    ["journal", "bet in My bets", "bets in My bets"], ["alert_rules", "alert", "alerts"], ["dashboards", "dashboard", "dashboards"],
  ];
  const parts = words.filter(([k]) => counts[k]).map(([k, one, many]) => `${counts[k]} ${counts[k] === 1 ? one : many}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "";
}

export function AuthBoot() {
  const me = useMe();
  const [offer, setOffer] = useState<{ uid: string; counts: Partial<Record<CollectionName, number>> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (DEMO_MODE) { void loadMe(); return; }   // #17/#73: demo has no layout hint; the header's Combos/Kalshi links come from /api/me
    let live = true;
    (async () => {
      const m = await loadMe();
      if (!live || !m?.auth) return;
      if (!m.user) { setRepo(guestRepo(getLocalRepo())); return; }
      try {
        setRepo(await new SupabaseRepo().load());
      } catch {
        return;   // keep local data; next load retries
      }
      const local = getLocalRepo();
      const counts = Object.fromEntries(NAMES.filter((n) => n !== "alert_events").map((n) => [n, local.snapshot(n).length]).filter(([, c]) => c));
      let asked = true;
      try { asked = localStorage.getItem(askedKey(m.user.id)) === "1"; } catch { /* storage off */ }
      if (live && !asked && Object.keys(counts).length) setOffer({ uid: m.user.id, counts });
    })();
    return () => { live = false; };
  }, []);

  async function importNow() {
    if (!offer) return;
    setBusy(true);
    const local = getLocalRepo();
    const body = { profile: local.profileSnapshot(), ...Object.fromEntries(NAMES.map((n) => [n, local.snapshot(n)])) };
    const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ import: body }) });
    if (res.ok) {
      try {
        for (const n of [...NAMES, "profile"]) localStorage.removeItem(`me:v1:${n}`);
      } catch { /* storage off */ }
      setRepo(await new SupabaseRepo().load());
    }
    done();
  }
  function done() {
    try { if (offer) localStorage.setItem(askedKey(offer.uid), "1"); } catch { /* storage off */ }
    setBusy(false);
    setOffer(null);
  }

  return (
    <>
      {me && !me.demo && !me.billing && process.env.NODE_ENV !== "production" && (
        <p role="status" className="fixed bottom-20 left-4 z-40 rounded-input border border-border bg-raised px-3 py-1.5 text-xs text-muted shadow md:bottom-4">
          Dev: Stripe not configured
        </p>
      )}
      <Dialog open={!!offer} onClose={done} title="Bring your saved items?">
        <p className="text-sm leading-relaxed text-soft">
          This browser has {offer && summary(offer.counts)}. Import them into your account? They&apos;ll then be on every device
          you sign in on, and removed from this browser.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btn} onClick={done} disabled={busy}>Not now</button>
          <button type="button" className={btnPrimary} onClick={importNow} disabled={busy}>{busy ? "Importing…" : "Import"}</button>
        </div>
      </Dialog>
    </>
  );
}
