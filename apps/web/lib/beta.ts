// Beta features (not live for customers): only admins (ADMIN_EMAILS) and testers with a live comp grant see them,
// whatever their plan (getMe().beta). Every surface carries <BetaBadge> (components/beta/BetaBadge.tsx).
// To launch a feature, remove it from BETA_FEATURES: its live rule below takes over, and the badges disappear.
import { can, type Tier } from "@/lib/entitlements";

import { BETA_FEATURES, type Gated } from "./beta-list";
export { BETA_FEATURES, type Gated };

const LIVE: Record<Gated, (me: Who) => boolean> = {
  combos: (me) => can(me.tier, "combos"),                               // Premium
  kalshi: () => process.env.KALSHI_DATA_PERMISSION === "true",          // server only: Kalshi's written permission
};

type Who = { tier: Tier; beta?: boolean };
export const isBeta = (f: Gated): boolean => BETA_FEATURES.includes(f);

/** May this person use `f`? Beta: testers only (any plan). Live: the feature's own rule. Server routes call this too. */
export const canBeta = (me: Who, f: Gated): boolean => (isBeta(f) ? !!me.beta : LIVE[f](me));

/** #17/#73 (Nov 20): the gated nav links (Combos, Kalshi) this person sees, decided on the server (/api/me and the root
 *  layout), so every page's header shows the same links. The Kalshi rule reads a server-only env var the browser can't. */
export const navFeatures = (me: Who): Gated[] => (Object.keys(LIVE) as Gated[]).filter((f) => canBeta(me, f));
