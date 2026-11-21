// Subset of apps/web/lib/types.ts + EventResponse (apps/web/lib/api.ts) the extension reads.
// Copied, not imported: the extension is a standalone project.
declare const __KISMET_ORIGIN__: string;
/** Web app origin, set at build time from KISMET_ORIGIN (default http://localhost:3000). */
export const API: string = __KISMET_ORIGIN__;

export interface Side {
  side_index: 0 | 1;
  outcome: string;
  ask: number;
  mid: number;
  fee: number;
  win_prob: number;
  edge: number;
  roi_pct: number;
  model_level: string;
  model_neff: number;
  model_events: number;
  realistic_edge?: number | null;
}

interface StakeRow { stake_usd: number; filled_usd: number; avg_price: number; expected_profit_usd: number; roi_pct: number }
export interface Execution {
  spread: number; spread_cost: number; fee_at_ask: number; retention: number; capacity_usd: number;
  stakes: StakeRow[]; verdict: "worth it" | "thin" | "not worth it" | "no sellers" | "no book"; warning?: string;
}

export interface Market {
  id: string;
  question: string;
  event: string; slug: string; url: string;
  niche: string; market_type: string;
  hours_to_close: number; closes_at: number;
  spread: number;
  sides: Side[];
  best: Side;
  execution?: Execution;
}

export interface EventResponse {
  event_id: string; event: string; slug: string;
  markets: Market[];   // sorted by best estimated return
  flags: Market[];     // flagged markets (with execution)
}

// Messages content/popup/sidepanel → background
export type Msg =
  | { type: "event"; slug: string }
  | { type: "open"; slug: string; marketId: string | null }
  | { type: "session" }
  | { type: "telemetry"; slug: string; markets: number };

/** Sign-in from /ext/connect: short-lived token (chrome.storage.session), exp in ms. */
export interface Auth { token: string; exp: number; tier: "free" | "pro" | "premium" }
export interface SessionInfo { signedIn: boolean; tier: Auth["tier"] | null }

// chrome.storage.local key for what the side panel shows
export interface Selection { slug: string; marketId: string | null; at: number }
