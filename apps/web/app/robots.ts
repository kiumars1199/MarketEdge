// robots.txt (docs/14 §6, T-76, T-281). AI crawlers may ignore this; middleware also refuses them (lib/bots.ts, docs/15).
import type { MetadataRoute } from "next";
import { PUBLIC_FOR_USER_AGENTS, TRAINING_BOTS, USER_AGENTS } from "@/lib/bots";
import { siteUrl } from "@/lib/site";

/** Signed-in app pages and plumbing: nothing for a search engine there. */
const PRIVATE = ["/api/", "/auth/", "/login", "/reset-password", "/onboarding", "/account", "/settings", "/watchlist", "/journal", "/alerts", "/dashboards", "/admin",
  "/kalshi",   // Kalshi data page: behind KALSHI_DATA_PERMISSION (docs/16 §2), not for search
  "/bets", "/markets", "/combos", "/tools", "/ext/",   // T-276: account-only (signed out they redirect to /signup)
  "/oauth"];   // T-280: consent screen for apps connecting to the MCP server

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: TRAINING_BOTS, disallow: "/" },
      // T-281: an assistant fetching a page because a person asked (not training) may read the public pages. "/$" = the
      // home page only; every other path stays off-limits, as middleware enforces (lib/bots.ts agentAllowed).
      { userAgent: [...USER_AGENTS], allow: PUBLIC_FOR_USER_AGENTS.map((p) => (p === "/" ? "/$" : p)), disallow: "/" },
      { userAgent: "*", allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
