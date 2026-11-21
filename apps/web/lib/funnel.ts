// Conversion funnel (docs/OVERHAUL.md §F3, T-299). Shared by the browser (lib/telemetry.ts funnel()), the server
// (lib/funnel-server.ts), the API route (app/api/funnel) and the admin page (app/admin/funnel). Pure: no Node or
// Next imports.
//
// Where each step fires:
//   landing_view     signed out, on `/` (instrumentation-client.ts → watchFunnelPaths), once per visit
//   signup_start     signed out, on `/signup`, once per visit
//   signup_done      server, the first sign-in of a new account (lib/auth/finish.ts → onFirstSignIn)
//   first_bets_view  signed in, on `/bets`, once per user
//   first_bet_click  signed in, the "Bet on …" card button (components/trade/VenueButton.tsx), once per user
//   upgrade_view     on `/pricing`; once per user signed in, once per visit signed out
//   checkout_start   signed in, the plan button that starts Stripe Checkout (Plans.tsx track("checkout_started")), once per user
//   trial_start      server, Stripe webhook: a subscription created in trial, once per user
//   paid             server, Stripe webhook: the first invoice.paid with an amount above zero, once per user
// Persistence: Supabase `funnel_events` (supabase/migrations/20261120000200_funnel_events.sql), unique per user and step.

export const FUNNEL_STEPS = ["landing_view", "signup_start", "signup_done", "first_bets_view", "first_bet_click",
  "upgrade_view", "checkout_start", "trial_start", "paid"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export const STEP_LABELS: Record<FunnelStep, string> = {
  landing_view: "Landing page view", signup_start: "Sign-up started", signup_done: "Signed up",
  first_bets_view: "First Best bets view", first_bet_click: "First “Bet on Polymarket” click",
  upgrade_view: "Plans page view", checkout_start: "Checkout started", trial_start: "Trial started", paid: "Paid",
};

/** Who may send a step from the browser. Server steps (signup_done, trial_start, paid) are never accepted from a client. */
export const CLIENT_STEPS: Partial<Record<FunnelStep, "anon" | "user" | "both">> = {
  landing_view: "anon", signup_start: "anon", upgrade_view: "both",
  first_bets_view: "user", first_bet_click: "user", checkout_start: "user",
};

export const isClientStep = (x: unknown): x is FunnelStep => typeof x === "string" && Object.hasOwn(CLIENT_STEPS, x);

/** Whether this caller may record this step: anon-only steps from signed-out visitors, user steps from signed-in ones. */
export function allowed(step: FunnelStep, signedIn: boolean): boolean {
  const who = CLIENT_STEPS[step];
  return who === "both" || (who === "anon" && !signedIn) || (who === "user" && signedIn);
}

/** The page-view step for a committed URL path, if any. */
export function stepForPath(path: string): FunnelStep | null {
  const p = path.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  return p === "/" ? "landing_view" : p === "/signup" ? "signup_start" : p === "/bets" ? "first_bets_view" : p === "/pricing" ? "upgrade_view" : null;
}

export interface FunnelRow { day: string; event: string; n: number }
export interface FunnelReport {
  days: { day: string; counts: Record<FunnelStep, number> }[];
  totals: Record<FunnelStep, number>;
  /** totals[step] / totals[previous step]; null for the first step or when the previous step is 0. */
  conversion: Record<FunnelStep, number | null>;
}

const zero = () => Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])) as Record<FunnelStep, number>;

/** (day, event, n) rows → one row per day for the last `days` days ending `today` (UTC, YYYY-MM-DD), totals, conversion. */
export function funnelReport(rows: FunnelRow[], today: string, days = 30): FunnelReport {
  const end = Date.parse(`${today}T00:00:00Z`);
  const list = Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const byDay = new Map(list.map((d) => [d, zero()]));
  const totals = zero();
  for (const r of rows) {
    const c = byDay.get(String(r.day).slice(0, 10));
    if (!c || !(FUNNEL_STEPS as readonly string[]).includes(r.event)) continue;
    const n = Number(r.n) || 0;
    c[r.event as FunnelStep] += n;
    totals[r.event as FunnelStep] += n;
  }
  const conversion = Object.fromEntries(FUNNEL_STEPS.map((s, i) => {
    const prev = i ? totals[FUNNEL_STEPS[i - 1]!] : 0;
    return [s, i && prev > 0 ? totals[s] / prev : null];
  })) as Record<FunnelStep, number | null>;
  return { days: list.map((day) => ({ day, counts: byDay.get(day)! })), totals, conversion };
}
