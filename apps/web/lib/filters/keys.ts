// URL short keys for FilterState fields (docs/04 § URL encoding). Its own module with a type-only import (T-295):
// lib/telemetry.ts reads it from instrumentation-client.ts, which runs on every page, and importing url.ts there
// pulled lib/filters/state.ts and zod into the bundle every page loads.
import type { FilterState } from "./state";

export type Kind = "str" | "num" | "bool" | "list";
export const KEYS = {
  q: ["q", "str"], view: ["view", "str"], tier: ["tier", "str"], c: ["categories", "list"], xc: ["exclude_categories", "list"],
  t: ["topics", "list"], mt: ["market_types", "list"], per: ["periods", "list"], side: ["side", "str"],
  p0: ["price_min", "num"], p1: ["price_max", "num"], x0: ["pays_min", "num"], x1: ["pays_max", "num"],
  wp: ["win_prob_min", "num"], wp1: ["win_prob_max", "num"], e: ["edge_min", "num"],
  conf: ["edge_low_positive", "bool"], roi: ["roi_min", "num"], val: ["validated_only", "bool"],
  vd: ["verdicts", "list"], us: ["us", "bool"], ret: ["retention_min", "num"], cap: ["capacity_min_usd", "num"],
  ev: ["min_events", "num"], cw: ["closes_within_h", "num"], ca: ["closes_after_h", "num"],
  live: ["live_only", "bool"], fq: ["frequency", "list"], vol: ["volume_min", "num"],
  v24: ["volume_24h_min", "num"], liq: ["liquidity_min", "num"], sp: ["spread_max", "num"],
  wl: ["watchlisted_only", "bool"], fav: ["favorites_only", "bool"], g: ["group_by_event", "bool"],
  s: ["sort", "str"], tz: ["tz", "str"], pg: ["page", "num"], ps: ["page_size", "num"],
} as const satisfies Record<string, readonly [keyof FilterState, Kind]>;
