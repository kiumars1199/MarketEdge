"use client";
// Web → extension bridge: chrome.runtime.sendMessage(EXT_ID, intent) (docs/16 §3). The extension only accepts
// messages from our origin (externally_connectable) and re-checks every order nonce with our server.
import { useEffect, useState } from "react";
import { create } from "zustand";

export type ExtReply<T> = ({ ok: true } & T) | { ok: false; error: string; missing?: true };

type ChromeLike = { runtime?: { sendMessage?: (id: string, msg: unknown, cb: (r: unknown) => void) => void; lastError?: unknown } };

/** Send one message to the extension. `missing` = extension not installed (or not allowed on this origin). */
export function ext<T>(extId: string, msg: Record<string, unknown>, timeoutMs = 20_000): Promise<ExtReply<T>> {
  const rt = (globalThis as { chrome?: ChromeLike }).chrome?.runtime;
  if (!rt?.sendMessage) return Promise.resolve({ ok: false, error: "Extension not installed.", missing: true });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "The extension didn't answer." }), timeoutMs);
    try {
      rt.sendMessage!(extId, msg, (r) => {
        clearTimeout(t);
        if (rt.lastError || !r) resolve({ ok: false, error: "Extension not installed.", missing: true });
        else resolve(r as ExtReply<T>);
      });
    } catch {
      clearTimeout(t);
      resolve({ ok: false, error: "Extension not installed.", missing: true });
    }
  });
}

export interface TradeConfig { enabled: boolean; env: "demo" | null; extensionId: string; riskUrl: string }

let configP: Promise<TradeConfig | null> | null = null;
/** /api/trade/config, fetched once per page load. Null while loading or when trading is off. */
export function useTradeConfig(): TradeConfig | null {
  const [c, setC] = useState<TradeConfig | null>(null);
  useEffect(() => {
    configP ??= fetch("/api/trade/config").then((r) => (r.ok ? (r.json() as Promise<TradeConfig>) : null)).catch(() => null);
    let live = true;
    configP.then((v) => live && setC(v?.enabled ? v : null));
    return () => { live = false; };
  }, []);
  return c;
}

/** One side of what the ticket trades. Index 0 = Kalshi "Yes", 1 = "No". */
export interface TicketSide { label: string; winProb: number | null; ask: number | null }
/** Opens the order ticket. Lane C's combo builder calls openTicket() with the combo's Kalshi ticker (docs/18 §5.5). */
export interface TicketPrefill {
  title: string;
  ticker: string | null;          // mapped Kalshi ticker; null = user types one (paper mode)
  side: 0 | 1;
  sides: [TicketSide, TicketSide];
  /** For My bets. A combo with no single Polymarket market uses market_id `kalshi-${ticker.replace(/[^\w-]/g, "_")}` (/api/settle rejects ids outside [\w-]). */
  journal: { market_id: string; question: string; category: string | null; niche: string | null };
}

export const useTicket = create<{ prefill: TicketPrefill | null; openTicket: (p: TicketPrefill) => void; close: () => void }>((set) => ({
  prefill: null,
  openTicket: (prefill) => set({ prefill }),
  close: () => set({ prefill: null }),
}));
export const openTicket = (p: TicketPrefill) => useTicket.getState().openTicket(p);
