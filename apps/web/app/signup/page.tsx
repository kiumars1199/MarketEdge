// Sign up (docs/19 P2, T-275, T-276): Google first, then email + password on one screen (the password tab creates the
// account, with email confirmation). Every signed-out page outside the public list lands here with ?next=.
import { AuthPage } from "@/components/auth/AuthPage";
import { FREE_BEST_BETS_A_DAY } from "@/lib/entitlements";

export const metadata = { title: "Sign up free", description: `Create a free Kismet account with Google or an email and password: ${FREE_BEST_BETS_A_DAY} best bets a day free, no card.` };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <AuthPage mode="signup" searchParams={searchParams} />;
}
