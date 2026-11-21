// Tier table (docs/01-product.md § Tiers, docs/08-auth-billing.md § Entitlements) as data.
// Server routes enforce; the UI mirrors with <UpgradeGate>. Infinity = unlimited.
import { demoFlag } from "@/lib/config";
import { currentMe, useMe } from "@/lib/me";
import { canBeta, type Gated } from "@/lib/beta";

/** Browser copy of DEMO_MODE, as lib/repo has it. Not imported from lib/repo: that pulls the local repo, its schemas
 *  and zod into the layout bundle every page loads (Header and MobileNav call useEntitlements; T-295). */
const DEMO_MODE = demoFlag(process.env.NEXT_PUBLIC_DEMO_MODE);

export type Tier = "free" | "pro" | "premium";

export type Feature =
  | "live_data" | "exact_edge" | "all_filters" | "full_execution" | "journal" | "csv_export"
  | "dashboards" | "alerts" | "push" | "webhooks" | "extension" | "combos";

export type QuotaKey = "presets" | "dashboards" | "watchlist" | "alert_rules" | "flags_revealed" | "rows" | "best_bets_day";

const FEATURES: Record<Tier, readonly Feature[]> = {
  free: [],
  pro: ["live_data", "exact_edge", "all_filters", "full_execution", "journal", "csv_export",
    "dashboards", "alerts", "push"],
  premium: ["live_data", "exact_edge", "all_filters", "full_execution", "journal", "csv_export",
    "dashboards", "alerts", "push", "webhooks", "extension", "combos"],   // docs/19 P3: combos are Premium
};

/** docs/19 P3: Free sees exactly this many Best bets a day (fewer only when fewer exist). Copy and server both read it. */
export const FREE_BEST_BETS_A_DAY = 10;

const QUOTAS: Record<Tier, Record<QuotaKey, number>> = {
  // rows: default rows per list request (site setting free_rows can change it); best_bets_day: Free Best bets a day
  // (docs/19 P3), fixed, so every page that states it and the server sample that enforces it say the same number
  free: { presets: 1, dashboards: 0, watchlist: 10, alert_rules: 0, flags_revealed: 3, rows: 10, best_bets_day: FREE_BEST_BETS_A_DAY },
  pro: { presets: 25, dashboards: 3, watchlist: Infinity, alert_rules: 20, flags_revealed: Infinity, rows: Infinity, best_bets_day: Infinity },
  premium: { presets: Infinity, dashboards: Infinity, watchlist: Infinity, alert_rules: 100, flags_revealed: Infinity, rows: Infinity, best_bets_day: Infinity },
};

/** Default Free delay (docs/01). The live value is site setting free_delay_min: read it with delayMin() (lib/settings-core). */
export const DELAY_MIN: Record<Tier, number> = { free: 15, pro: 0, premium: 0 };

const RANK: Record<Tier, number> = { free: 0, pro: 1, premium: 2 };
const asTier = (t: unknown): Tier => (t === "pro" || t === "premium" ? t : "free");

/** Plan from a subscriptions row: the higher of the webhook-written tier and an unexpired admin comp (T-140).
 *  A comp never lowers a paid plan; an expired or unknown comp is ignored. */
export function effectiveTier(
  row: { tier?: unknown; comp_tier?: unknown; comp_expires_at?: string | null } | null | undefined,
  now = Date.now(),
): Tier {
  const paid = asTier(row?.tier);
  const comp = asTier(row?.comp_tier);
  const exp = row?.comp_expires_at ? Date.parse(row.comp_expires_at) : Infinity;
  const live = comp !== "free" && !(exp <= now);
  return live && RANK[comp] > RANK[paid] ? comp : paid;
}

/** An admin comp (T-140) that is set and not expired: the account is a tester (beta access, lib/beta.ts). */
export function compLive(row: { comp_tier?: unknown; comp_expires_at?: string | null } | null | undefined, now = Date.now()): boolean {
  if (asTier(row?.comp_tier) === "free") return false;
  const exp = row?.comp_expires_at ? Date.parse(row.comp_expires_at) : Infinity;
  return !(exp <= now);
}

export const can = (tier: Tier, feature: Feature): boolean => FEATURES[tier].includes(feature);
export const quota = (tier: Tier, key: QuotaKey): number => QUOTAS[tier][key];

/** Client tier for display (server routes enforce). Demo mode has no auth or billing, so everyone is premium. */
export const clientTier = (): Tier => (DEMO_MODE ? "premium" : currentMe()?.tier ?? "free");

export function useEntitlements() {
  const me = useMe();
  const tier: Tier = DEMO_MODE ? "premium" : me?.tier ?? "free";
  const beta = DEMO_MODE || !!me?.beta;
  return {
    tier, beta,
    /** #40: false until /api/me answers. Until then `tier` reads "free"; never show an upsell on that guess. */
    known: DEMO_MODE || me !== null,
    can: (f: Feature) => can(tier, f),
    /** Beta-gated features (lib/beta.ts): display only, the server checks again. */
    canBeta: (f: Gated) => canBeta({ tier, beta }, f),
    quota: (k: QuotaKey) => quota(tier, k),
  };
}
