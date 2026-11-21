"use client";

// Owner: Lane C (T-23 MarketDrawer). Mounted once in the app shell. URL contract: ?m=<market id>&side=<0|1>.
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useOpenDrawer } from "./drawer";
import { MarketDetail } from "./MarketDetail";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function DrawerHost() {
  const params = useSearchParams();
  const { close } = useOpenDrawer();
  const marketId = params.get("m");
  const sideParam = params.get("side");
  const side = sideParam === "0" ? 0 : sideParam === "1" ? 1 : undefined;

  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Last focus outside the drawer = what opened it (focus can't leave the open drawer, see below).
  const lastOutside = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const note = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && !root.current?.contains(e.target)) lastOutside.current = e.target;
    };
    document.addEventListener("focusin", note);
    return () => document.removeEventListener("focusin", note);
  }, []);

  // focus the drawer when it opens or switches market
  const openedId = useRef<string | null>(null);   // the market it opened on (not one switched to inside)
  useEffect(() => {
    if (!marketId) return;
    openedId.current ??= marketId;
    panel.current?.scrollTo(0, 0);
    panel.current?.focus();
  }, [marketId]);

  // aria-modal for real: while open, everything else on the page is `inert` (Tab and Shift+Tab stay in the drawer,
  // clicks and screen readers skip the page behind). Native <dialog>s (trade ticket) stay live: they open above.
  // On close, focus returns to the opener; if a re-render replaced it, to the link that opens the same market.
  const open = !!marketId;
  useEffect(() => {
    if (!open) return;
    const back = lastOutside.current;
    const made: Element[] = [];
    for (let n: Element | null = root.current; n && n !== document.body; n = n.parentElement)
      for (const sib of Array.from(n.parentElement?.children ?? []))
        if (sib !== n && !sib.hasAttribute("inert") && !["DIALOG", "SCRIPT", "NEXT-ROUTE-ANNOUNCER"].includes(sib.tagName)) {
          sib.setAttribute("inert", "");
          made.push(sib);
        }
    return () => {
      for (const el of made) el.removeAttribute("inert");
      const id = openedId.current;
      openedId.current = null;
      const target = back?.isConnected ? back : id ? document.querySelector<HTMLElement>(`a[href*="m=${CSS.escape(id)}"]`) : null;
      target?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!marketId) return;
    // Escape inside a modal <dialog> opened over the drawer (e.g. the trade ticket) closes only that dialog.
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]") && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marketId, close]);

  // inert stops Tab at the page; this wraps it from the last control to the first (and back) instead of the browser bar
  const wrapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const all = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    const first = all[0], last = all.at(-1);
    if (!first || !last) return;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };

  if (!marketId) return null;
  return (
    <div ref={root}>
      <div aria-hidden="true" onClick={close} className="fixed inset-0 z-40 hidden bg-black/50 md:block" />
      <div
        ref={panel}
        onKeyDown={wrapTab}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Market details"
        className="fixed inset-0 z-50 overflow-y-auto focus:outline-none overscroll-contain border-l border-border bg-surface p-5 pb-10 md:inset-y-0 md:left-auto md:w-[460px] md:p-[26px]"
      >
        <MarketDetail id={marketId} side={side} onClose={close} />
      </div>
    </div>
  );
}
