"use client";
// Drawer → "Add to combo" (docs/18 §5.1). Toggles this market's chosen side in the user's combo tray.
import { useState } from "react";
import { useEntitlements } from "@/lib/entitlements";
import { legOf } from "@/lib/combos";
import type { Side, StoreMarket } from "@/lib/types";
import { useCombo } from "./useCombo";
import { BetaBadge } from "@/components/beta/BetaBadge";

export function AddToCombo({ m, s, className }: { m: StoreMarket; s: Side; className: string }) {
  const leg = useCombo((c) => c.legs.find((l) => l.market_id === m.id));
  const add = useCombo((c) => c.add);
  const remove = useCombo((c) => c.remove);
  const [error, setError] = useState<string | null>(null);
  const inCombo = leg?.side_index === s.side_index;
  // Combos are Premium (lib/beta.ts live rule; out of beta since Nov 21)
  const allowed = useEntitlements().canBeta("combos");
  if (!allowed) return null;
  return (
    <>
      <button
        type="button" aria-pressed={inCombo} className={className}
        onClick={() => {
          if (inCombo) return remove(m.id);
          setError(add(legOf(m, s)));
        }}
      >
        {inCombo ? "In combo ✓" : leg ? "Switch combo side" : "Add to combo"} <BetaBadge className="ml-1.5" />
      </button>
      {error && <p role="alert" className="basis-full text-[13px] text-warning">{error}</p>}
    </>
  );
}
