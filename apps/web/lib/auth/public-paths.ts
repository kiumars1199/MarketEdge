// T-276: what a signed-out visitor may reach. The app pages (APP_PAGES) need an account: they redirect to
// /signup?next=<page> (or /login for the OAuth consent pages), API routes answer 401 JSON. Pure (no Node or
// Next imports) so the middleware and tests share it. Extend the lists here, nowhere else.

/** Pages (and their sub-paths) a signed-out visitor sees. /m and /event render a teaser (no verdict) when signed out. */
export const PUBLIC_PAGES: readonly string[] = [
  "/", "/pricing", "/about", "/track-record", "/status",
  "/terms", "/privacy", "/refunds", "/disclaimer", "/contact",
  "/login", "/signup", "/reset-password", "/auth", "/maintenance",
  "/m", "/event",
];

/** Static and discovery files: search engines, OAuth discovery, share images, icons, manifest. */
export const PUBLIC_FILES: readonly string[] = [
  "/robots.txt", "/sitemap.xml", "/llms.txt", "/.well-known",
  "/favicon.ico", "/icon", "/icon.svg", "/apple-icon", "/apple-icon.png", "/opengraph-image", "/twitter-image", "/manifest.webmanifest",
  "/149e9513-01fa-4fb0-aad4-566afd725d1b",   // Vercel BotID challenge script + proxy (botid/next/config rewrites, Vercel only)
  "/_vercel",                                 // Vercel platform paths (analytics, insights) if ever enabled
];

/** API routes that work without a session: they need none, or check their own credential. */
export const PUBLIC_API: readonly string[] = [
  "/api/health",              // uptime check; details need CRON_SECRET
  "/api/meta",                // scan time and topics (extension popup)
  "/api/me",                  // "who am I": { user: null } signed out
  "/api/backtest",            // backtest.json summary: the same figures /track-record shows publicly (landing cards read it)
  "/api/auth",                // sign-in, sign-up, reset, Google, sign-out
  "/api/stripe/webhook",      // Stripe signature
  "/api/unsubscribe",         // signed token from the email
  "/api/alerts/run",          // CRON_SECRET
  "/api/settle/run",          // CRON_SECRET
  "/api/lifecycle/run",       // CRON_SECRET
  "/api/ext/token/refresh",   // extension bearer token
  "/api/ext/telemetry",       // extension, no user data
  "/api/trade/config",        // extension vault page: whether the paper ticket shows (false signed out)
  "/api/trade/nonce/verify",  // extension, consumes a signed nonce
  "/api/events/by-slug",      // extension (no cookies): the route itself needs a session or an extension token
  "/api/mcp",                 // MCP server: OAuth bearer tokens, checked by the route
  "/api/tz",                  // T-288: same-origin POST of the browser's time zone, sets one cookie, returns nothing
  "/api/funnel",              // T-299: same-origin POST of a funnel step; signed-out steps count too
];

/** #33 (Nov 20): the app's own pages, which need an account. A signed-out request for one goes to sign-up; a path that
 *  is in no list here is no page at all, so it gets the 404 page instead of a sign-up wall for a page that doesn't
 *  exist. test/account-wall.test.ts reads app/ and fails if a page folder is in no list, so a new page can't go
 *  public by being forgotten here. */
export const APP_PAGES: readonly string[] = [
  "/bets", "/markets", "/watchlist", "/journal", "/tools", "/alerts", "/dashboards", "/settings",
  "/account", "/onboarding", "/combos", "/kalshi", "/ext",
];

/** Signed-out visitors here go to /login (an existing account is expected), not /signup. */
export const LOGIN_FIRST: readonly string[] = ["/oauth"];

/** Pages that answer 404 to anyone who isn't an admin (requireAdmin), so they aren't redirected either. */
export const SELF_GUARDED: readonly string[] = ["/admin", "/e2e-mock"];

/** Campaign tags: with accounts off (no wall), a bare `/` plus these is still the landing (app/page.tsx). */
export const TRACKING = /^(utm_.*|fbclid|gclid|ref|deleted)$/;

export const under = (path: string, list: readonly string[]) =>
  list.some((p) => path === p || (p !== "/" && path.startsWith(p.endsWith("/") ? p : `${p}/`)));

export type Access = "public" | "api401" | "signup" | "login";

/** What a signed-out request for `path` (with `search` params) gets. */
export function signedOutAccess(path: string, search: URLSearchParams = new URLSearchParams()): Access {
  // `/` is always the landing signed out (app/page.tsx), whatever campaign tags it carries; only a market deep link
  // (?m=, the drawer) asks for an account so it can come back to that market after sign-up.
  if (path === "/") return search.has("m") ? "signup" : "public";
  if (path.startsWith("/api/") || path === "/api") return under(path, PUBLIC_API) ? "public" : "api401";
  if (under(path, PUBLIC_PAGES) || under(path, PUBLIC_FILES) || under(path, SELF_GUARDED)) return "public";
  if (path.startsWith("/_next/")) return "public";
  if (under(path, LOGIN_FIRST)) return "login";
  if (under(path, APP_PAGES)) return "signup";
  return "public";   // #33: no such page; Next answers with the 404 page (app/[...missing], app/not-found.tsx)
}
