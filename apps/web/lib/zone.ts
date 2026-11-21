// T-288: the visitor's IANA time zone, so the server renders times in it on the first paint (no UTC flash).
// The browser writes it to a small cookie (components/clock.tsx); on Vercel the request header is the fallback.
export const TZ_COOKIE = "tz";
export const TZ_HEADER = "x-vercel-ip-timezone";

const SHAPE = /^[A-Za-z0-9_+\-/]{1,64}$/;   // same shape as FilterState.tz
/** The zone if it is a real IANA zone this runtime knows, else null. Never throws. */
export function validZone(z: unknown): string | null {
  if (typeof z !== "string" || !SHAPE.test(z)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: z }).resolvedOptions().timeZone ? z : null;
  } catch {
    return null;
  }
}

/** Cookie first (the browser's own zone), then the edge's IP guess. null on a very first request with neither. */
export const pickZone = (cookie: string | undefined, header: string | null | undefined): string | null =>
  validZone(cookie ? decodeURIComponent(cookie) : undefined) ?? validZone(header ?? undefined);

/** An absolute time for a server-rendered page, in the visitor's zone with its name ("Nov 20, 3:04 PM EST"); in
 *  `fallback` (named too) when the zone is unknown, so it is never an unlabeled wrong time. */
export function zonedTime(unix: number, zone: string | null, opts: Intl.DateTimeFormatOptions, fallback = "America/New_York"): string {
  return new Date(unix * 1000).toLocaleString("en-US", { ...opts, timeZone: zone ?? fallback, timeZoneName: "short" }).replace(/[\u202f\u00a0]/g, " ");
}
