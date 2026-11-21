// T-288: the zone and clock for this request's server render (lib/zone.ts). Root layout passes them to <ClockProvider>.
import "server-only";
import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { TZ_COOKIE, TZ_HEADER, pickZone } from "./zone";

/** `zone`: the zone to render in (cookie, else Vercel header, else null); `saved`: the cookie's own zone, if any. */
export async function requestClock(): Promise<{ zone: string | null; saved: string | null }> {
  try {
    const [c, h] = await Promise.all([cookies(), headers()]);
    const cookie = c.get(TZ_COOKIE)?.value;
    return { zone: pickZone(cookie, h.get(TZ_HEADER)), saved: pickZone(cookie, null) };
  } catch (e) {
    unstable_rethrow(e);   // T-295: Next's "this route is dynamic" signal must reach Next, or a page would prerender
    return { zone: null, saved: null };   // outside a request (tests)
  }
}

export const requestZone = async (): Promise<string | null> => (await requestClock()).zone;

/** T-295: whether this request carries a Supabase session cookie (`sb-…`), so the server render of the header can
 *  start in the right state before /api/me answers. A prerendered page has no cookies: false. Only a hint (an expired
 *  cookie still counts); every gate checks the session itself. */
export async function hasSessionCookie(): Promise<boolean> {
  try {
    return (await cookies()).getAll().some((c) => c.name.startsWith("sb-"));
  } catch (e) {
    unstable_rethrow(e);
    return false;
  }
}
