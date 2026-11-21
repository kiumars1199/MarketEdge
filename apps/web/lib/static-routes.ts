// T-295 (docs/OVERHAUL.md §C): which pages are prerendered (static + ISR, cached at the edge) and how middleware.ts
// routes a request to them. Pure (no Node or Next imports): middleware, tests and the build check share it.
//
// A static page is the signed-out variant: under `dynamic = "force-static"` cookies() and headers() read as empty, so
// getMe() answers "signed out" (demo mode: the demo user, the same for everyone). Signed-in visitors must keep their own
// variant (plan buttons, exact curves), so middleware rewrites them to a dynamic twin under SIGNED_IN_PREFIX that
// re-exports the same page with `dynamic = "force-dynamic"`. `/` has no twin: signed-in (and demo) visitors get Best bets.

/** Every page that must be prerendered. scripts/perf/static-routes.test checks this against prerender-manifest.json. */
export const STATIC_PAGES: readonly string[] = [
  "/", "/pricing", "/about", "/track-record",
  "/terms", "/privacy", "/refunds", "/disclaimer", "/contact",
];

/** Static pages with per-user content: signed-in requests go to `${SIGNED_IN_PREFIX}${path}` (app/signed-in/*). */
export const TWINNED: readonly string[] = ["/pricing", "/about", "/track-record"];
export const SIGNED_IN_PREFIX = "/signed-in";

/** Seconds a static page may be served before a background regeneration; ops/upload.py also revalidates on each scan. */
export const STATIC_REVALIDATE_S = 300;

/** Campaign tags: a bare `/` plus these is still the landing (also lib/auth/public-paths.ts TRACKING). */
const TRACKING = /^(utm_.*|fbclid|gclid|ref|deleted)$/;

export interface RouteCtx {
  path: string;
  search: URLSearchParams;
  demo: boolean;          // DEMO_MODE: no signed-out state, everyone is the demo user
  auth: boolean;          // accounts configured (Supabase URL + anon key)
  signedIn: boolean;      // the session middleware just checked
}

export interface RouteDecision {
  /** Internal path to serve instead (URL in the browser unchanged), or null. */
  rewrite: string | null;
  /** The response is a prerendered page: no per-request nonce exists, so it gets STATIC_CSP. */
  prerendered: boolean;
}

/** Where a request for a page goes. Paths not in STATIC_PAGES pass through untouched (dynamic, nonce CSP). */
export function routeFor({ path, search, demo, auth, signedIn }: RouteCtx): RouteDecision {
  if (path === "/") {
    // Signed in, or demo: Best bets. Accounts off (no wall): a product query (?t=…) is the Free Best bets, as before.
    const product = [...search.keys()].some((k) => !TRACKING.test(k));
    if (demo || signedIn || (!auth && product)) return { rewrite: "/bets", prerendered: false };
    return { rewrite: null, prerendered: true };
  }
  if (!STATIC_PAGES.includes(path)) return { rewrite: null, prerendered: false };
  if (signedIn && !demo && TWINNED.includes(path)) return { rewrite: SIGNED_IN_PREFIX + path, prerendered: false };
  return { rewrite: null, prerendered: true };
}

/** The twins are reached only through routeFor's rewrite; a direct request is a 404 (no second copy of the page). */
export const isTwinPath = (path: string) => path === SIGNED_IN_PREFIX || path.startsWith(SIGNED_IN_PREFIX + "/");
