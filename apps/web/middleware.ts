// Session refresh (docs/08, docs/15 § Auth) and the account wall (T-276): signed out, only lib/auth/public-paths.ts
// is reachable; other pages redirect to /signup?next=<page>, other API routes answer 401.
// Refuses AI crawlers always (docs/15); the session part does nothing in demo mode or before Supabase is configured.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail, mfaRequired } from "@/lib/admin/core";
import { maintenanceOn } from "@/lib/maintenance";
import { agentAllowed } from "@/lib/bots";
import { isAppToken } from "@/lib/auth/app-token";
import { DEMO_MODE } from "@/lib/config";
import { signedOutAccess } from "@/lib/auth/public-paths";
import { isTwinPath, routeFor } from "@/lib/static-routes";

const COOKIE_OPTIONS = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
// Reachable during maintenance (T-142): sign-in (so an admin can always get back in), session, uptime check.
const MAINTENANCE_OPEN = ["/login", "/reset-password", "/auth", "/api/auth", "/api/me", "/api/health", "/maintenance"];
const under = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + "/"));
const hidden = () => Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });


/** docs/15 § Headers. Per-request nonce: Next stamps it on its own scripts (every dynamic page renders per request).
 *  'strict-dynamic' lets those scripts load chunks, Sentry, PostHog and BotID.
 *  `nonce` null (T-295): the policy for a prerendered page (lib/static-routes.ts). Its HTML is built once and served
 *  from the edge cache, so no per-request nonce can be in it: Next's inline bootstrap scripts need 'unsafe-inline', and
 *  without a nonce 'strict-dynamic' would block them, so script hosts are listed instead (Stripe, Vercel analytics,
 *  PostHog's asset host; chunks, Sentry and BotID load from 'self'). Prerendered pages hold no user data and reflect
 *  no request input; every other directive is the same. */
export function csp(nonce: string | null, dev = process.env.NODE_ENV !== "production") {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
  const posthog = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  const scripts = nonce === null
    ? `'self' 'unsafe-inline' https://js.stripe.com https://va.vercel-scripts.com https://us-assets.i.posthog.com`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://va.vercel-scripts.com`;
  return [
    "default-src 'self'",
    `script-src ${scripts}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",   // React style={} attributes (charts, virtual rows)
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${supabase.replace(/^https/, "wss")} ${posthog} https://*.posthog.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://api.stripe.com https://vitals.vercel-insights.com${dev ? " ws:" : ""}`.replace(/ +/g, " "),
    "frame-src https://js.stripe.com https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  // AI crawlers get nothing, demo mode included (robots.txt itself stays reachable: not matched below). Assistants
  // fetching for a person (ChatGPT-User, Claude-User, Perplexity-User) may read the public pages; any agent may reach
  // /api/mcp and OAuth discovery (lib/bots.ts agentAllowed).
  if (!agentAllowed(req.headers.get("user-agent"), req.nextUrl.pathname)) return new NextResponse("Automated access is not allowed.", { status: 403 });
  const path = req.nextUrl.pathname;
  if (isTwinPath(path)) return new NextResponse("Not found", { status: 404 });   // reached only through a rewrite (T-295)
  const policy = csp(btoa(crypto.randomUUID()));
  // Next reads the nonce from the request's CSP header; the browser enforces the response's.
  const next = () => {
    const headers = new Headers(req.headers);
    headers.set("content-security-policy", policy);
    const r = NextResponse.next({ request: { headers } });
    r.headers.set("content-security-policy", policy);
    return r;
  };
  /** T-295: the answer for a page request once the session is known: a prerendered page (no nonce exists in its HTML),
   *  a rewrite (signed-in `/` → Best bets, a signed-in /pricing → its dynamic twin), or the request as is. */
  const page = (signedIn: boolean, res: NextResponse, auth: boolean) => {
    const d = routeFor({ path, search: req.nextUrl.searchParams, demo: DEMO_MODE, auth, signedIn });
    if (d.prerendered) {
      const fixed = csp(null);
      const headers = new Headers(req.headers);
      headers.set("content-security-policy", fixed);
      const r = NextResponse.next({ request: { headers } });
      r.headers.set("content-security-policy", fixed);
      for (const c of res.cookies.getAll()) r.cookies.set(c);
      return r;
    }
    if (!d.rewrite) return res;
    const headers = new Headers(req.headers);
    headers.set("content-security-policy", policy);
    const to = req.nextUrl.clone();
    to.pathname = d.rewrite;
    const r = NextResponse.rewrite(to, { request: { headers } });
    r.headers.set("content-security-policy", policy);
    for (const c of res.cookies.getAll()) r.cookies.set(c);
    return r;
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // /api/admin* for a non-admin: 404 before routing, whatever the method or path (the routes' requireAdmin()
  // stays the real guard). With no auth configured, or in demo mode, nobody is an admin.
  const adminApi = under(req.nextUrl.pathname, ["/api/admin"]);
  if (DEMO_MODE || !url || !anon) return adminApi ? hidden() : page(false, next(), false);

  let res = next();
  const supabase = createServerClient(url, anon, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = next();
        for (const { name, value, options } of list) res.cookies.set(name, value, { ...options, ...COOKIE_OPTIONS });
      },
    },
  });
  const { data: got } = await supabase.auth.getUser();   // refreshes an expired access token; revoked session → null
  // T-280: an OAuth app's token in a cookie is signed out here (lib/auth/app-token.ts): those tokens are /api/mcp only.
  const data = got.user && isAppToken((await supabase.auth.getSession()).data.session?.access_token) ? { user: null } : got;

  const admin = isAdminEmail(data.user && { email: data.user.email, verified: !!data.user.email_confirmed_at }, process.env.ADMIN_EMAILS, DEMO_MODE) &&
    (!mfaRequired(process.env.ADMIN_REQUIRE_MFA) || (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel === "aal2");   // RT3-06
  if (adminApi && !admin) return hidden();
  if (!under(path, MAINTENANCE_OPEN) && (await maintenanceOn(url))) {
    if (!admin) {
      if (path.startsWith("/api/")) {
        return Response.json({ error: "Kismet is down for maintenance. Try again shortly." }, { status: 503, headers: { "Retry-After": "300" } });
      }
      const headers = new Headers(req.headers);
      headers.set("content-security-policy", policy);
      const to = req.nextUrl.clone();
      to.pathname = "/maintenance";
      to.search = "";
      const r = NextResponse.rewrite(to, { request: { headers }, status: 503 });
      r.headers.set("content-security-policy", policy);
      r.headers.set("Retry-After", "300");
      return r;
    }
  }
  if (!data.user) {
    const wall = accountWall(req);
    if (wall) {
      for (const c of res.cookies.getAll()) wall.cookies.set(c);   // keep any cookie the refresh just cleared
      return wall;
    }
  }
  return page(!!data.user, res, true);
}

/** The signed-out answer for a request outside the public list (T-276), or null to let it through. */
export function accountWall(req: NextRequest): NextResponse | null {
  const path = req.nextUrl.pathname;
  if (req.method === "OPTIONS") return null;   // CORS preflights carry no cookies
  // The e2e Stripe mock (next.config rewrite /v1/* → /e2e-mock/stripe, dev + E2E_MOCK only): server-to-server, no cookies.
  if (process.env.E2E_MOCK === "1" && process.env.NODE_ENV !== "production" && path.startsWith("/v1/")) return null;
  const access = signedOutAccess(path, req.nextUrl.searchParams);
  if (access === "public") return null;
  if (access === "api401") {
    return NextResponse.json({ error: "Sign in to use this.", signin: "/login" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const to = req.nextUrl.clone();
  to.pathname = access === "login" ? "/login" : "/signup";
  to.search = `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  return NextResponse.redirect(to);
}

export const config = {
  // pages and API routes; skip static assets, images, the Stripe webhook (raw body, no session) and e2e mock
  // api/revalidate: ops/upload.py (no cookies), checks its own secret (T-295)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|robots.txt|sitemap.xml|api/stripe/webhook|api/revalidate|e2e-mock).*)"],
};
