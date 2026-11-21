// Funnel recording on the server (T-299, lib/funnel.ts has the step list). Writes Supabase `funnel_events` with the
// service role, then (only when the row is new) sends the same step to PostHog from the server.
// Never throws: analytics must not break a page, a sign-in or a Stripe webhook. With no Supabase service role (demo,
// local) or before the migration is applied, nothing is counted and nothing is sent.
//
// PostHog privacy (lib/telemetry.ts rules): only when NEXT_PUBLIC_POSTHOG_KEY is set; a random distinct_id per event
// (never the user id or email), no person profile, no IP from the user (the request comes from our server), and
// properties pass the same allow-list as the browser (cleanProps).
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";
import type { FunnelStep } from "@/lib/funnel";
import { cleanProps } from "@/lib/telemetry";

export interface FunnelDeps {
  db?: () => SupabaseClient | null;
  fetchImpl?: typeof fetch;
  posthogKey?: string;
  posthogHost?: string;
  today?: () => string;
}

const defaultDb = () => (adminEnabled() ? supabaseAdmin() : null);

/** Records a step. Signed in: once per user (true only the first time). Signed out: once per call. Returns counted. */
export async function recordFunnel(step: FunnelStep, userId: string | null, props: Record<string, unknown> = {}, deps: FunnelDeps = {}): Promise<boolean> {
  try {
    const db = (deps.db ?? defaultDb)();
    if (!db) return false;
    const day = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
    let counted: boolean;
    if (userId) {
      const { data, error } = await db.from("funnel_events")
        .upsert({ user_id: userId, event: step, day }, { onConflict: "user_id,event", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(error.message);
      counted = (data?.length ?? 0) > 0;
    } else {
      const { error } = await db.from("funnel_events").insert({ event: step, day });
      if (error) throw new Error(error.message);
      counted = true;
    }
    if (counted) await capture(step, props, deps);
    return counted;
  } catch (e) {
    console.warn("[funnel] not recorded:", step, e instanceof Error ? e.message : e);
    return false;
  }
}

async function capture(step: FunnelStep, props: Record<string, unknown>, deps: FunnelDeps) {
  const key = deps.posthogKey ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = (deps.posthogHost ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/+$/, "");
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, event: step, distinct_id: randomUUID(), properties: { ...cleanProps(props), $process_person_profile: false, $lib: "kismet-server" } }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) console.warn("[funnel] PostHog HTTP", res.status);
  } catch (e) {
    console.warn("[funnel] PostHog capture failed:", e instanceof Error ? e.message : e);
  }
}
