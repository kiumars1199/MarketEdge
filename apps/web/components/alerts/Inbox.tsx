"use client";
// Alert inbox list (F-23): used by the header bell and the Inbox tab on /alerts.
import { usePathname } from "next/navigation";
import { softNav } from "@/lib/softNav";
import { drawerHref } from "@/components/market/drawer";
import { ago } from "@/lib/format";
import { getRepo } from "@/lib/repo";
import { useCollection } from "@/lib/repo/hooks";
import type { AlertEvent } from "@/lib/repo/types";

export function useInbox() {
  const events = useCollection("alert_events");
  const last = [...events].sort((a, b) => b.fired_at.localeCompare(a.fired_at)).slice(0, 50);
  return { events: last, unread: events.filter((e) => !e.read_at).length };
}

export async function markAllRead() {
  const repo = getRepo();
  const now = new Date().toISOString();
  for (const e of await repo.alert_events.list()) if (!e.read_at) await repo.alert_events.update(e.id, { read_at: now });
}

export function InboxList({ events, onOpen, compact }: { events: AlertEvent[]; onOpen?: () => void; compact?: boolean }) {
  const pathname = usePathname();
  const open = (e: AlertEvent) => {
    if (!e.read_at) void getRepo().alert_events.update(e.id, { read_at: new Date().toISOString() });
    onOpen?.();
    softNav(pathname + drawerHref(e.market_id, e.side_index ?? undefined, window.location.search));
  };
  if (!events.length) {
    return <p className="px-4 py-8 text-center text-sm text-muted">No alerts yet. When a rule matches, it shows up here.</p>;
  }
  return (
    <ul className="divide-y divide-border" data-testid="inbox">
      {events.map((e) => {
        const p = (e.payload ?? {}) as { title?: string; message?: string; rule_name?: string };
        return (
          <li key={e.id}>
            <button type="button" onClick={() => open(e)} className={`flex w-full gap-3 px-4 text-left hover:bg-raised ${compact ? "py-3" : "py-4"}`}>
              <span aria-hidden="true" className={`mt-1.5 size-2 flex-none rounded-full ${e.read_at ? "bg-transparent" : "bg-accent"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${e.read_at ? "text-soft" : "font-semibold text-text"}`}>{p.title ?? `Market ${e.market_id}`}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{p.message}</span>
                <span className="mt-1 block text-xs text-muted">{p.rule_name ? `${p.rule_name} · ` : ""}{ago(Date.parse(e.fired_at) / 1000)}{e.read_at ? "" : <span className="sr-only"> · unread</span>}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
