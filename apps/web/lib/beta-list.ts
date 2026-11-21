// The beta list on its own (no imports), so light modules (the footer, OG images) can read it. Rules: lib/beta.ts.
export type Gated = "combos" | "kalshi";
/** Still in beta. Empty since Nov 21, 2026 (owner decision): Combos (docs/18 §5, Premium) and the Kalshi page
 *  (docs/16 §2, every signed-in plan; KALSHI_DATA_PERMISSION=true on Vercel and Railway) are live. */
export const BETA_FEATURES: readonly Gated[] = [];
