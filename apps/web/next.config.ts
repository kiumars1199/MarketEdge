import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { DEMO_MODE } from "./lib/config";

const e2eMock = process.env.E2E_MOCK === "1" && process.env.NODE_ENV !== "production";
/** Vercel BotID only where its challenge proxy exists (docs/15); elsewhere checkBotId() passes through. */
const onVercel = !!process.env.VERCEL;

const config: NextConfig = {
  reactStrictMode: true,
  // T-70: Best bets moved from /flags to /. Old links, saved views and shares keep working (query is kept).
  redirects: async () => [{ source: "/flags", destination: "/", permanent: true }],
  poweredByHeader: false,
  // docs/15 § Headers. The CSP is per request (nonce) and set in middleware.ts.
  headers: async () => [{
    source: "/:path*",
    headers: [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ],
  }],
  // One switch: the browser's demo flag is the server's (fail-safe rule in lib/config.ts), never set on its own.
  env: { NEXT_PUBLIC_DEMO_MODE: String(DEMO_MODE), NEXT_PUBLIC_BOTID: onVercel ? "1" : "" },
  // e2e only: the Stripe SDK can't take a base path, so its /v1 calls are routed to the in-app mock.
  ...(e2eMock ? { rewrites: async () => [{ source: "/v1/:path*", destination: "/e2e-mock/stripe/v1/:path*" }] } : {}),
};

export default onVercel ? withBotId(config) : config;
