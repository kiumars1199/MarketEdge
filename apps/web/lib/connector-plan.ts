// The AI connector allowance (MCP, T-280), said one way everywhere (#38/#58/#72, Marc Nov 20): the /pricing compare
// table, the plan cards, /account, the OAuth consent page, llms.txt and the connector's own refusals.
// The numbers are also what lib/abuse.ts RULES enforce (mcp_pro_daily, mcp_premium read these), so copy and limits
// can't drift. Client-safe: no server imports.
import type { Tier } from "@/lib/entitlements";

export const CONNECTOR_PRO_PER_DAY = 3;          // Pro: tool calls per user, rolling 24 hours
export const CONNECTOR_PREMIUM_PER_MINUTE = 60;  // Premium: no daily cap, a per-minute rate limit

/** "3 calls a day" (Pro), "no daily cap (up to 60 calls a minute)" (Premium), "not included" (Free). */
export function connectorAllowance(tier: Tier): string {
  if (tier === "premium") return `no daily cap (up to ${CONNECTOR_PREMIUM_PER_MINUTE} calls a minute)`;
  if (tier === "pro") return `${CONNECTOR_PRO_PER_DAY} calls a day`;
  return "not included";
}

/** The whole statement in one line: "Pro: 3 calls a day. Premium: no daily cap (up to 60 calls a minute). Not on Free." */
export const CONNECTOR_PLANS_LINE =
  `Pro: ${connectorAllowance("pro")}. Premium: ${connectorAllowance("premium")}. Not on Free.`;

export const CONNECTOR_NAME = "Use Kismet in Claude, ChatGPT and Cursor";
