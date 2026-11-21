// Server-only auth helpers (docs/08, docs/15 § Auth). There is no browser Supabase client: sign-in, the
// callback and every data read go through the server, so the session cookies can be HttpOnly.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { DEMO_MODE } from "@/lib/config";
import { FREE_BEST_BETS_A_DAY, compLive, effectiveTier, type Tier } from "@/lib/entitlements";
import { isAdminEmail } from "@/lib/admin/core";
import { delayMin } from "@/lib/settings-core";
import { behindWords } from "@/lib/format";
import { isAppToken } from "./app-token";

const env = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
});

/** Accounts are on when not in demo mode and the Supabase project is configured. */
export const authEnabled = () => !DEMO_MODE && !!env().url && !!env().anon;
/** What /login and /account say while accounts are off. "Everything is unlocked" is true only in demo mode;
 *  a production build without Supabase keys serves the Free plan (lib/entitlements.ts). */
export const accountsOffNote = (demo = DEMO_MODE, delay = delayMin("free")) =>
  demo
    ? "Accounts aren't switched on here. Everything is unlocked and saved in this browser."
    : `Sign-in isn't available yet. You can browse on the Free plan: every open market, ${behindWords(delay)}, ${FREE_BEST_BETS_A_DAY} Best bets a day, with returns shown as ranges.`;
/** The service-role client can be built (cron jobs). */
export const adminEnabled = () => !!env().url && !!env().service;

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/** Per-request client acting as the signed-in user (RLS applies). */
export async function supabaseServer(): Promise<SupabaseClient> {
  const jar = await cookies();
  const { url, anon } = env();
  return createServerClient(url, anon, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, { ...options, ...COOKIE_OPTIONS });
        } catch { /* server component render: middleware refreshes cookies instead */ }
      },
    },
  });
}

/** Service-role client. Server only; bypasses RLS: use for webhook writes and account deletion. */
export function supabaseAdmin(): SupabaseClient {
  const { url, service } = env();
  if (!url || !service) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface SessionUser { id: string; email: string; verified: boolean }

/** The verified user (getUser() checks the JWT with Supabase), or null. `verified` = email confirmed. */
export async function getUser(): Promise<SessionUser | null> {
  if (!authEnabled()) return null;
  try {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (!data.user || isAppToken((await sb.auth.getSession()).data.session?.access_token)) return null;   // T-280: app tokens are /api/mcp only
    return { id: data.user.id, email: data.user.email ?? "", verified: !!data.user.email_confirmed_at };
  } catch {
    return null;
  }
}

export interface Me {
  user: SessionUser | null;
  tier: Tier;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** Admin (ADMIN_EMAILS) or a live comp grant: sees beta features (lib/beta.ts). Demo mode: everyone. */
  beta: boolean;
}

const NO_SUB = { status: null, current_period_end: null, cancel_at_period_end: false };

/** Tier comes only from the webhook-written subscriptions row (docs/15 § Billing). Demo mode = premium.
 *  React cache(): one auth check and one row read per page render, shared by the root layout's header (#17/#73) and
 *  the page itself. Outside a server render (route handlers) cache() doesn't memoize, so each call reads fresh. */
export const getMe = cache(async function getMe(): Promise<Me> {
  if (DEMO_MODE) return { user: null, tier: "premium", ...NO_SUB, beta: true };   // demo has no customers
  const user = await getUser();
  if (!user) return { user: null, tier: "free", ...NO_SUB, beta: false };
  // "*" so a deploy that runs before the T-140 migration (comp columns) still reads the paid tier.
  // #40 (Nov 20): a failed read used to come back as "no subscription", so a paying user saw the Free view until the
  // next load. Retry once; if it still fails, throw rather than quietly downgrade (pages show their error state).
  const sb = await supabaseServer();
  let res = await sb.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle();
  if (res.error) res = await sb.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle();
  if (res.error && !isAdminEmail(user, process.env.ADMIN_EMAILS, DEMO_MODE)) throw new Error(`subscriptions read failed: ${res.error.message}`);
  return meOf(user, res.error ? null : res.data);
});

type SubRow = { tier?: unknown; comp_tier?: unknown; comp_expires_at?: string | null; status?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean | null };

/** Plan, beta and admin from a verified user and their subscriptions row: the one rule getMe and getMeForUser share. */
export function meOf(user: SessionUser, data: SubRow | null | undefined): Me {
  const admin = isAdminEmail(user, process.env.ADMIN_EMAILS, DEMO_MODE);
  const tier: Tier = admin ? "premium" : effectiveTier(data);   // admins get every paid feature
  return {
    user, tier, beta: admin || compLive(data),
    status: data?.status ?? null,
    current_period_end: data?.current_period_end ?? null,
    cancel_at_period_end: !!data?.cancel_at_period_end,
  };
}

/** getMe() for a user verified some other way than the session cookie (the MCP bearer token, lib/mcp/auth.ts).
 *  Reads the row with the service role, scoped to that user id: OAuth-client tokens get no direct table access
 *  (supabase/migrations/20261120000000_oauth_clients_no_tables.sql). Never the demo shortcut: no user, no plan. */
export async function getMeForUser(user: SessionUser): Promise<Me> {
  const { data, error } = await supabaseAdmin().from("subscriptions").select("*").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(`subscriptions read failed: ${error.message}`);
  return meOf(user, data);
}

export const getTier = async (): Promise<Tier> => (await getMe()).tier;

/** `next=` must be a same-origin relative path (docs/15 § open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  // Printable ASCII only (RT-13): anything else can't go in a Location header (500) and is never one of our paths.
  if (!next || !/^\/(?![/\\])/.test(next) || /[^\x20-\x7e]/.test(next)) return fallback;
  return next;
}

/** CSRF: mutations must come from our own origin (docs/15 § Web hardening). The one check every mutating route uses. */
/** GET downloads opened by a link: the browser's Sec-Fetch-Site says whether a cross-site page started it (RT2-01). */
export function sameSiteRequest(req: Request): boolean {
  return req.headers.get("sec-fetch-site") === "same-origin" || sameOrigin(req);
}

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return host === new URL(req.url).host || host === req.headers.get("host") || origin === process.env.NEXT_PUBLIC_SITE_URL;
  } catch {
    return false;
  }
}
