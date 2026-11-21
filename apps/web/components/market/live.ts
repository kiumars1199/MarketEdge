"use client";
// "Worth keeping open all day" (docs/17), from real data only:
// - useLiveAsk: cards on screen refresh their price every 60 s from one /api/book?tokens= batch (Pro; the server
//   checks the tier again). Only cards in view, only while the tab is visible.
// - useLastVisit: when the previous visit started, for the "New" badge.
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

export type Tick = { ask: number; at: number };
const REFRESH_MS = 60_000;
const MAX = 24;   // server batch limit

const inView = new Map<string, number>();   // token -> cards showing it
const ticks = new Map<string, Tick>();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let kick: ReturnType<typeof setTimeout> | null = null;
let off = false;   // 403/401: not on a plan with live prices; stop asking

async function poll() {
  if (off || document.visibilityState !== "visible" || !inView.size) return;
  const tokens = [...inView.keys()].slice(0, MAX);
  const res = await fetch(`/api/book?tokens=${tokens.join(",")}`, { cache: "no-store" }).catch(() => null);
  if (!res) return;
  if (res.status === 401 || res.status === 403) return void (off = true);
  if (!res.ok) return;
  const body = (await res.json().catch(() => null)) as { asks?: Record<string, number | null>; fetched_at?: number } | null;
  for (const [t, ask] of Object.entries(body?.asks ?? {}))
    if (typeof ask === "number" && ticks.get(t)?.ask !== ask) ticks.set(t, { ask, at: body?.fetched_at ?? Date.now() });   // `at` = last change
  subs.forEach((f) => f());
}

function watch(token: string) {
  inView.set(token, (inView.get(token) ?? 0) + 1);
  timer ??= setInterval(() => void poll(), REFRESH_MS);
  if (!kick) kick = setTimeout(() => ((kick = null), void poll()), 1500);   // first look soon after cards settle
}
function unwatch(token: string) {
  const n = (inView.get(token) ?? 1) - 1;
  if (n > 0) inView.set(token, n);
  else inView.delete(token);
  if (!inView.size && timer) {
    clearInterval(timer);
    timer = null;
  }
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** Latest live ask for a token while `ref` is on screen; undefined until the first refresh (or when `on` is false). */
export function useLiveAsk(token: string | null | undefined, on: boolean, ref: RefObject<Element | null>): Tick | undefined {
  useEffect(() => {
    const el = ref.current;
    if (!on || !token || !el || typeof IntersectionObserver === "undefined") return;
    let shown = false;
    const io = new IntersectionObserver(([e]) => {
      if (!!e?.isIntersecting === shown) return;
      shown = !shown;
      if (shown) watch(token);
      else unwatch(token);
    });
    io.observe(el);
    return () => { io.disconnect(); if (shown) unwatch(token); };
  }, [token, on, ref]);
  return useSyncExternalStore(subscribe, () => (on && token ? ticks.get(token) : undefined), () => undefined);
}

const LAST = "me:v1:last_visit";   // localStorage: when the latest visit started (unix s)
const THIS = "me:v1:prev_visit";   // sessionStorage: the visit before this one, fixed for the whole session

/** Start of the previous visit (unix s), or null on a first visit / storage off. A visit = a browser session. */
export function useLastVisit(): number | null {
  const [prev, setPrev] = useState<number | null>(null);
  useEffect(() => {
    try {
      let p = sessionStorage.getItem(THIS);
      if (p === null) {
        p = localStorage.getItem(LAST) ?? "";
        sessionStorage.setItem(THIS, p);
        localStorage.setItem(LAST, String(Math.floor(Date.now() / 1000)));
      }
      const n = Number(p);
      setPrev(p && Number.isFinite(n) ? n : null);
    } catch { /* storage off: no badges */ }
  }, []);
  return prev;
}
