"use client";
import { ExternalLink } from "@/components/kit/icons";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { btn, btnPrimary, card } from "@/components/kit";
import { ext } from "@/lib/trade/ext";

type State = { at: "working" } | { at: "missing" } | { at: "error"; msg: string } | { at: "done"; tier: string };

export function Connect({ storeUrl }: { storeUrl: string | null }) {
  const [s, setS] = useState<State>({ at: "working" });

  const run = useCallback(async () => {
    setS({ at: "working" });
    const cfg = (await fetch("/api/trade/config").then((r) => r.json()).catch(() => null)) as { extensionId?: string } | null;
    const id = cfg?.extensionId;
    if (!id) return setS({ at: "error", msg: "Couldn't reach Kismet. Try again." });
    const ping = await ext(id, { type: "ping" }, 5000);
    if (!ping.ok) return setS(ping.missing ? { at: "missing" } : { at: "error", msg: ping.error });
    const res = await fetch("/api/ext/token", { method: "POST" });
    const auth = (await res.json().catch(() => ({}))) as { token?: string; exp?: number; tier?: string; error?: string };
    if (!res.ok || !auth.token) return setS({ at: "error", msg: auth.error ?? "Couldn't sign the extension in." });
    const r = await ext<{ tier: string }>(id, { type: "token", auth });
    setS(r.ok ? { at: "done", tier: r.tier } : { at: "error", msg: r.error });
  }, []);
  useEffect(() => { void run(); }, [run]);

  return (
    <section className={`${card} flex flex-col items-start gap-3 p-6`} aria-live="polite">
      {s.at === "working" && <p className="text-muted">Connecting the extension…</p>}
      {s.at === "done" && (
        <>
          <h2 className="text-lg font-semibold text-accent-soft">The extension is signed in</h2>
          <p className="text-sm text-soft">
            Plan: <span className="capitalize text-text">{s.tier}</span>. {s.tier === "premium" ? "Open any Polymarket event page to see Kismet next to each market." : "Badges on Polymarket are a Premium feature."}
          </p>
          {s.tier !== "premium" && <Link href="/pricing" className={btnPrimary}>See Premium</Link>}
          <p className="text-xs text-muted">The sign-in lasts 30 minutes and renews itself while your browser is open. You can close this tab.</p>
        </>
      )}
      {s.at === "missing" && (
        <>
          <h2 className="text-lg font-semibold">Install the extension first</h2>
          <p className="text-sm text-soft">It isn&apos;t installed in this browser yet (Chrome, Edge, Brave or Arc on a computer).</p>
          {storeUrl ? (
            <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={btnPrimary}>Add to Chrome <ExternalLink size={15} /></a>
          ) : (
            <p className="text-sm text-muted">Coming soon to the Chrome Web Store.</p>
          )}
          <button type="button" className={btn} onClick={run}>I installed it</button>
        </>
      )}
      {s.at === "error" && (
        <>
          <h2 className="text-lg font-semibold">Couldn&apos;t connect</h2>
          <p role="alert" className="text-sm text-negative">{s.msg}</p>
          <button type="button" className={btn} onClick={run}>Try again</button>
        </>
      )}
    </section>
  );
}
