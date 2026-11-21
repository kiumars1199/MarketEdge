// / (docs/19 P1, T-276, T-295): the landing, prerendered and revalidated (lib/static-routes.ts), so a signed-out visitor
// gets cached HTML from the edge. Signed-in users and demo mode never reach this page: middleware.ts rewrites their `/`
// to /bets (Best bets). A signed-out /?m=… deep link goes to /signup?next=… (account wall); a build without accounts
// configured keeps the old rule: bare / is the landing, any product query shows the Free Best bets (also a rewrite).
import { Landing } from "@/components/landing/Landing";
import { FREE_BEST_BETS_A_DAY } from "@/lib/entitlements";

export const dynamic = "force-static";
export const revalidate = 300;   // STATIC_REVALIDATE_S; ops/upload.py also revalidates after each scan

export const metadata = {
  title: { absolute: "Kismet · Which Polymarket bets are worth it today?" },
  description: `Placing a bet or two? See which Polymarket bets look like good value today, how often bets like them win, and what $10 pays. ${FREE_BEST_BETS_A_DAY} bets a day, free. No card.`,
};

export default function Page() {
  return <Landing />;
}
