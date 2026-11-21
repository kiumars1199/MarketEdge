// GET /api/combos → CombosResponse: suggested combos, the same for everyone allowed (docs/18 §5.2). Combos are in beta
// (lib/beta.ts): testers only; everyone else gets none, so the Combos row hides.
import { COMBO_PAYS, browseCombos, gateCombos, suggestCombos, type ComboPays } from "@/lib/data/combos";
import { withTier } from "@/lib/data/respond";
import { canBeta } from "@/lib/beta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ?pays=2|3|5|10: the Combos page (docs/19 P5), combos paying at least that much; anything else is the Best bets row.
export const GET = (req: Request) => withTier(req, "markets", (store, tier, me) => {
  if (!canBeta(me, "combos")) return Response.json({ groups: [] });   // beta: testers only (lib/beta.ts)
  const pays = Number(new URL(req.url).searchParams.get("pays"));
  const groups = COMBO_PAYS.includes(pays as ComboPays) ? browseCombos(store, pays as ComboPays) : suggestCombos(store);
  return Response.json(gateCombos(groups, tier));
});
