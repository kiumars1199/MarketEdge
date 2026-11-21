// Error reporting (Sentry) and product analytics (PostHog), docs/14 §5 and docs/10 T-64.
// Both are off unless their key is set, and both are loaded with a dynamic import so they cost nothing
// when off. Privacy: no cookies or storage (PostHog persistence "memory"), no autocapture, no replay,
// URLs lose their query strings, emails are redacted, and only allow-listed event properties are sent.
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { KEYS } from "@/lib/filters/keys";   // not ./url: that pulls zod into every page (T-295)
import { stepForPath, type FunnelStep } from "@/lib/funnel";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const redact = (s: string) => s.replace(EMAIL, "[email]");
/** Drops query and hash; collapses market/event ids so paths carry no market data. */
export const cleanUrl = (u: string) =>
  redact(u.replace(/[?#].*$/, "").replace(/\/(m|event|events|markets)\/[^/]+/g, "/$1/[id]"));

// ---------------------------------------------------------------- Sentry

const DROP_HEADERS = /^(authorization|cookie|set-cookie|x-api-key|x-supabase-auth|proxy-authorization)$/i;

export function scrubSentryEvent(e: ErrorEvent): ErrorEvent {
  if (e.request) {
    delete e.request.cookies;
    delete e.request.query_string;
    delete e.request.data;
    if (e.request.url) e.request.url = cleanUrl(e.request.url);
    if (e.request.headers)
      e.request.headers = Object.fromEntries(Object.entries(e.request.headers).filter(([k]) => !DROP_HEADERS.test(k)));
  }
  if (e.user) e.user = e.user.id ? { id: e.user.id } : undefined;
  if (e.message) e.message = redact(e.message);
  for (const ex of e.exception?.values ?? []) if (ex.value) ex.value = redact(ex.value);
  e.breadcrumbs = e.breadcrumbs?.map(scrubBreadcrumb);
  return e;
}

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  if (b.message) b.message = redact(b.message);
  if (b.data) {
    for (const k of ["url", "to", "from"]) if (typeof b.data[k] === "string") b.data[k] = cleanUrl(b.data[k]);
  }
  return b;
}

export const sentryOptions = (dsn: string | undefined) => ({
  dsn,
  enabled: !!dsn,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  beforeSend: scrubSentryEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

// ---------------------------------------------------------------- PostHog

/** T-64 events. Lane L adds checkout_started / checkout_completed calls from the billing flow. */
export type AnalyticsEvent = "filter_used" | "preset_saved" | "upgrade_clicked" | "checkout_started" | "checkout_completed";
type Props = Record<string, string | number | boolean | string[]>;

const ALLOWED = new Set(["filters", "feature", "plan", "interval", "tier", "source", "count"]);

export function cleanProps(p: Record<string, unknown> = {}): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(p)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= 40 && !v.includes("@")) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string" && x.length <= 40 && !x.includes("@")).slice(0, 30);
  }
  return out;
}

/** FilterState field names set in a screener URL (docs/04 short keys). Values are never sent. */
export const filterKeys = (url: string): string[] => {
  try {
    const keys = [...new URL(url).searchParams.keys()].filter((k) => k !== "pg" && k in KEYS);
    return [...new Set(keys.map((k) => KEYS[k as keyof typeof KEYS][0]))].sort();
  } catch {
    return [];
  }
};

interface PhEvent { event: string; properties: Record<string, unknown>; $set?: Record<string, unknown>; $set_once?: Record<string, unknown> }
const URL_KEY = /url|referrer|pathname|href/i;

function scrubBag(bag: Record<string, unknown> | undefined) {
  if (!bag) return;
  for (const [k, v] of Object.entries(bag)) {
    if (typeof v === "string") bag[k] = URL_KEY.test(k) ? cleanUrl(v) : redact(v);
  }
}

/** PostHog before_send. A pageview on the same path as the last one is a filter change → `filter_used`. */
export function makeBeforeSend() {
  let lastPath: string | null = null;
  return <E extends PhEvent | null>(e: E): E | null => {
    if (!e) return e;
    if (e.event === "$pageview") {
      const raw = String(e.properties.$current_url ?? "");
      const path = cleanUrl(raw);
      const filters = filterKeys(raw);
      if (path === lastPath) {
        if (!filters.length) return null;
        e.event = "filter_used";
      }
      lastPath = path;
      if (filters.length) e.properties.filters = filters;
    }
    scrubBag(e.properties);
    scrubBag(e.$set);
    scrubBag(e.$set_once);
    return e;
  };
}

type PostHog = typeof import("posthog-js").default;
let ph: PostHog | undefined;

export async function initAnalytics(key = process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  if (!key || typeof window === "undefined" || ph) return;
  const { default: posthog } = await import("posthog-js");
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    persistence: "memory",          // no cookies, no localStorage
    disable_persistence: true,
    person_profiles: "never",
    autocapture: false,             // clicked text would carry market questions and prices
    capture_pageview: "history_change",
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false,      // Sentry owns errors
    capture_performance: false,
    save_referrer: false,
    ip: false,
    mask_personal_data_properties: true,
    before_send: makeBeforeSend() as never,
  });
  ph = posthog;
}

/** Fire-and-forget; a no-op when analytics is off. Only allow-listed properties leave the browser. */
export function track(event: AnalyticsEvent, props?: Record<string, unknown>) {
  if (event === "checkout_started") funnel("checkout_start");   // T-299: the funnel counts it whether or not PostHog is on
  ph?.capture(event, cleanProps(props));
}

// ---------------------------------------------------------------- Funnel (T-299, lib/funnel.ts)
// The browser only names the step; the server decides whether it counts (signed in or out, first time for this user)
// and records it in Supabase, then sends it to PostHog from the server (lib/funnel-server.ts). No ids, URLs or
// properties leave the browser here, nothing is stored in the browser, and nothing is sent in demo mode.

const sentThisLoad = new Set<FunnelStep>();
const demo = () => process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/** One POST per step per page load (the server keeps "first" steps to once per user across loads and devices). */
export function funnel(step: FunnelStep) {
  if (typeof window === "undefined" || demo() || sentThisLoad.has(step)) return;
  sentThisLoad.add(step);
  void fetch("/api/funnel", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step }),
    keepalive: true, credentials: "same-origin",
  }).catch(() => {});
}

let watching = false;
/** Page-view steps (/, /signup, /bets, /pricing) on the URL the app actually committed: the first load, then every
 *  client navigation (history push/replace, back/forward). A link that redirects counts where it lands. */
export function watchFunnelPaths() {
  if (typeof window === "undefined" || watching) return;
  watching = true;
  let last = "";
  const check = () => {
    const path = window.location.pathname;
    if (path === last) return;
    last = path;
    const step = stepForPath(path);
    if (step) funnel(step);
  };
  for (const k of ["pushState", "replaceState"] as const) {
    const orig = window.history[k];
    window.history[k] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const r = orig.apply(this, args);
      queueMicrotask(check);
      return r;
    };
  }
  window.addEventListener("popstate", check);
  check();
}
