// Browser start-up hook (Next 15.3+). Each tool loads only when its public key is set.
import { initBotId } from "botid/client/core";
import { initAnalytics, sentryOptions, watchFunnelPaths } from "@/lib/telemetry";

watchFunnelPaths();   // T-299 funnel page-view steps: tiny same-origin POST, not deferred so a quick bounce still counts

// Sentry and PostHog start once the page is idle, so their download and init stay off the first paint and
// hydration (Lighthouse TBT/LCP). Errors before that still reach Next's error pages.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const whenIdle = (fn: () => void) =>
  "requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 2000);
whenIdle(() => {
  if (dsn) void import("@sentry/nextjs").then((Sentry) => Sentry.init(sentryOptions(dsn)));
  void initAnalytics();
});

// Vercel BotID (docs/15): the browser half of checkBotId() in lib/abuse.ts. Same routes as the server checks.
// Only on Vercel (next.config sets the flag), where the challenge proxy exists.
if (process.env.NEXT_PUBLIC_BOTID === "1") {
  initBotId({
    protect: [
      { path: "/api/markets", method: "GET" },
      { path: "/api/markets/*", method: "GET" },
      { path: "/api/flags", method: "GET" },
      { path: "/api/events/*", method: "GET" },
      { path: "/api/suggest", method: "GET" },
      { path: "/api/combos", method: "GET" },
      { path: "/api/book", method: "GET" },
      { path: "/api/auth/magic-link", method: "POST" },
      { path: "/api/auth/password", method: "POST" },
      { path: "/api/auth/password/update", method: "POST" },
      { path: "/api/auth/reset", method: "POST" },
      { path: "/api/stripe/checkout", method: "POST" },
    ],
  });
}
