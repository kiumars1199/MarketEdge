"use client";
// T-288: one clock and one time zone for every time on the page. The server render and the hydration render both use
// the request's zone and "now" from the root layout (lib/zone-server.ts), so they match byte for byte in any zone and
// the first paint is already local time. After hydration: the browser's own zone and the live clock. With no zone at
// all (very first request, no Vercel header) clock times render as a hidden same-width placeholder until mount, never
// as a wrong time. Relative times ("closes in 3h") only need "now", so they always render.
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ago, closesIn, closesLine, gameTime } from "@/lib/format";
import { validZone } from "@/lib/zone";

interface Clock { zone: string | null; now: number | null }
const Ctx = createContext<Clock>({ zone: null, now: null });

const noop = () => () => {};
export const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);
const browserZone = () => {
  try { return validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? undefined; } catch { return undefined; }
};
/** Root layout: `zone` from the tz cookie or the Vercel header (null if neither), `saved` = the cookie's zone (null
 *  if none), `now` = the request time (ms). */
export function ClockProvider({ zone, saved, now, children }: { zone: string | null; saved: string | null; now: number; children: ReactNode }) {
  useEffect(() => {
    // Remember the browser's zone for the next server render. The server sets the cookie (httpOnly, like every
    // cookie here: the browser sets none, test/security.test.ts); asked once, and again only when the zone changes.
    const z = browserZone();
    if (z && z !== saved) void fetch("/api/tz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tz: z }) }).catch(() => {});
  }, [saved]);
  return <Ctx.Provider value={{ zone, now }}>{children}</Ctx.Provider>;
}

/** "Now" in ms: the request time while hydrating (so server and client agree), the live clock after. `tickMs`
 *  re-renders on that interval. Outside a provider (tests) the server render uses the clock floored to the minute. */
export function useNow(tickMs = 0): number {
  const hydrated = useHydrated();
  const { now } = useContext(Ctx);
  const [, tick] = useState(0);
  useEffect(() => {
    tick((x) => x + 1);   // a client-side mount after hydration: refresh at once, the request time may be old
    if (!tickMs) return;
    const t = setInterval(() => tick((x) => x + 1), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  // the live clock is the point after hydration; the hydration render uses the request time so it matches the server
  return hydrated ? Date.now() : now ?? Math.floor(Date.now() / 60_000) * 60_000;
}

/** The zone to format clock times in: the request's while hydrating (null = unknown), the browser's after. */
export function useZone(): { zone: string | undefined; known: boolean } {
  const hydrated = useHydrated();
  const { zone } = useContext(Ctx);
  if (hydrated) return { zone: browserZone(), known: true };
  return { zone: zone ?? undefined, known: zone !== null };
}

/** A clock time that isn't known yet: same text shape (so the same width), hidden from sight and screen readers. */
export const Pending = ({ text }: { text: string }) => <span aria-hidden="true" className="invisible" data-time-pending="">{text}</span>;

/** Close time on cards and the market page: game time in the user's zone, "closes in …" from one clock. */
export function useWhen(closesAt: number | null | undefined) {
  const now = useNow();
  const { zone, known } = useZone();
  const game = gameTime(closesAt, now, known ? zone : "UTC");
  return {
    game: known ? <span data-game="">{game}</span> : <Pending text={game} />,
    closes: closesLine(closesAt, now),
    Closes: closesLine(closesAt, now, true),
    full: known && closesAt != null ? fullTime(closesAt, zone) : undefined,
  };
}

/** "Nov 20, 2026, 3:04 PM EST" in `zone` (local when undefined). */
export const fullTime = (unix: number, zone: string | undefined) =>
  new Date(unix * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).replace(/ /g, " ");

/** "3h" from the shared clock (lib/format closesIn: one rounding rule, down). */
export function ClosesIn({ at }: { at: number | null | undefined }) {
  return <>{closesIn(at, useNow())}</>;
}
/** "closes in 3h" / "Closed" from the shared clock. */
export function ClosesLine({ at, cap = false }: { at: number | null | undefined; cap?: boolean }) {
  return <>{closesLine(at, useNow(), cap)}</>;
}

/** QA-A #34/#44/#67: "12 min ago" that keeps counting while the page stays open (a server-rendered age froze at the
 *  render time). Same clock as every other time on the page. */
export function Ago({ at }: { at: number | null | undefined }) {
  return <span data-ago="">{ago(at, useNow(30_000))}</span>;
}
