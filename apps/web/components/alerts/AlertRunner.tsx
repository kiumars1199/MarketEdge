"use client";
// Demo alert evaluator (docs/10 demo deltas): runs enabled rules in the open tab once on load and every
// 2 minutes, writes alert_events (inbox) and shows a browser notification when allowed. Mounted in app/layout.tsx.
import { useEffect } from "react";
import { drawerHref } from "@/components/market/drawer";
import { runRules } from "@/lib/alerts";
import { fetchMarket, fetchMarkets } from "@/lib/api";
import { showNotification } from "@/lib/notify";
import { getRepo } from "@/lib/repo";
import type { Execution } from "@/lib/types";

const EVERY_MS = 120_000;
const memory = new Map<string, Set<string> | boolean>();
let running: Promise<number> | null = null;

/** Evaluate all enabled rules now. Returns how many new alerts fired. Shared by the timer and "Run now". */
export function runAlertsNow(): Promise<number> {
  running ??= (async () => {
    try {
      const repo = getRepo();
      const rules = (await repo.alert_rules.list()).filter((r) => r.enabled);
      if (!rules.length) return 0;
      const { timezone, odds_format } = await repo.profile.get();
      const events = await runRules(rules, {
        repo, timeZone: timezone, odds: odds_format, memory,
        fetchMarkets: (q) => fetchMarkets(q),
        fetchMarket: (id) => fetchMarket(id).then((r) => r.market, () => null),
        fetchBook: async (token, q, cat) => {
          const res = await fetch(`/api/book?${new URLSearchParams({ token, q: String(q), cat })}`);
          const x = res.ok ? ((await res.json()) as Execution) : null;
          return x?.book_ok ? (x as Execution & { book_ok: true }) : null;
        },
      });
      for (const e of events) {
        if (!e.sent_channels.includes("push")) continue;
        const p = e.payload as { title: string; message: string };
        showNotification(p.title, p.message, () => {
          location.assign(location.pathname + drawerHref(e.market_id, e.side_index ?? undefined, location.search));
        });
      }
      return events.length;
    } catch {
      return 0; // offline or API down: next tick retries
    } finally {
      running = null;
    }
  })();
  return running;
}

export function AlertRunner() {
  useEffect(() => {
    void runAlertsNow();
    const t = setInterval(() => void runAlertsNow(), EVERY_MS);
    return () => clearInterval(t);
  }, []);
  return null;
}
