// Shell navigation (docs/06 § App shell, "Words to use").
export const MAIN_TABS = [
  { href: "/bets", label: "Best bets" },   // "/" is the landing page when signed out (docs/19 P1)
  { href: "/markets", label: "All markets" },
  { href: "/watchlist", label: "My list" },
  { href: "/journal", label: "My bets" },
  { href: "/track-record", label: "Results" },
] as const;

/** Signed out (T-276): the app needs an account, so the header shows the sales pages instead. */
export const SALES_TABS = [
  { href: "/about", label: "How it works" },
  { href: "/track-record", label: "Results" },
  { href: "/pricing", label: "Pricing" },
] as const;

export const MORE_LINKS = [
  { href: "/journal", label: "My bets" },
  { href: "/track-record", label: "Results" },
  { href: "/tools", label: "Tools" },
  { href: "/alerts", label: "Alerts" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/settings", label: "Settings" },
  { href: "/status", label: "Status" },
  { href: "/about", label: "How it works" },
] as const;

/** Beta features (lib/beta.ts): shown only to testers, each with a Beta pill. */
export const BETA_LINKS = [
  { href: "/combos", label: "Combos", feature: "combos" },
  { href: "/kalshi", label: "Kalshi", feature: "kalshi" },
] as const;

export const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + "/") || (href === "/bets" && pathname === "/");
