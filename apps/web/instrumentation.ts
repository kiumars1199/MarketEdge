// Server/edge start-up hook (Next 15). Sentry only when NEXT_PUBLIC_SENTRY_DSN is set; PII scrubbed in lib/telemetry.
import type { Instrumentation } from "next";
import { sentryOptions } from "@/lib/telemetry";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init(sentryOptions(dsn));
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
