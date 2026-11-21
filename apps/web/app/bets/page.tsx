import { OnboardingNudge } from "@/components/onboarding/OnboardingNudge";
import { BestBets } from "@/components/screener/BestBets";
import { firstPage } from "@/lib/data/respond";
import { getUser } from "@/lib/auth/server";
import { markFirstBetsVisit } from "@/lib/activation";

export const metadata = { title: { absolute: "Best bets · Kismet" }, description: "Bets that have won more often in the past than their price suggests, after the fee." };

type Search = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const params = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0]! : v]])));
  const [initial, user] = await Promise.all([firstPage(params, "flags"), getUser()]);   // P6: page 1 + Closing soon ship with the HTML
  if (user) markFirstBetsVisit(user.id);   // T-276: admin activation count (first visit only)
  return (
    // min-h: the footer starts below the fold, so cards arriving after hydration don't shift it (CLS)
    <div className="mx-auto flex min-h-svh w-full max-w-[1400px] flex-col gap-4">
      <OnboardingNudge />
      {/* no Suspense: the page is dynamic (searchParams), and a boundary here made React hold the reveal of the
          server-rendered cards for up to 300 ms, which Lighthouse counted as a late LCP */}
      <BestBets initial={initial} />
    </div>
  );
}
