// Combos (docs/19 P5, docs/18 §5): browse combos by payout (2x+, 3x+, 5x+, 10x+). Same for every Premium user:
// Best bets on different events closing within a day, only combos whose cautious chance still beats the price.
// Live since Nov 21 (owner decision). Premium (lib/entitlements); Free and Pro get what it is and the upgrade link.
import Link from "next/link";
import { Suspense } from "react";
import { getMe } from "@/lib/auth/server";
import { canBeta } from "@/lib/beta";
import { ComboBrowser } from "./ComboBrowser";

export const metadata = { title: "Combos", description: "Two- and three-leg combos from Best bets on different events, by payout.", alternates: { canonical: "/combos" } };
export const dynamic = "force-dynamic";

export default async function Page() {
  const allowed = canBeta(await getMe(), "combos");
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div>
        <h1 className="font-heading text-[28px] font-bold leading-tight">Combos</h1>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-muted">
          Best bets from different events, closing within a day, in one bet. Every leg has to win, so the payout is bigger
          and the chance is lower. A combo is shown only if it still beats its price when every leg uses our cautious
          chance.
        </p>
      </div>
      {allowed ? (
        <Suspense>
          <ComboBrowser />
        </Suspense>
      ) : (
        <div data-testid="combos-upgrade" className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-5">
          <p className="text-sm text-soft">Combos are part of Premium: browse them by payout and build your own in the combo tray.</p>
          <Link href="/pricing" className="inline-flex min-h-11 items-center rounded-input bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover">See Premium</Link>
        </div>
      )}
    </div>
  );
}
