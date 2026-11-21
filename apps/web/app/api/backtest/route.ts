import type { BacktestResponse } from "@/lib/api";
import { chosenResult } from "@/lib/data/model";
import { withStore } from "@/lib/data/respond";
import { siteProof } from "@/lib/proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () =>
  withStore((store) => {
    const body: BacktestResponse = {
      ...store.backtest, chosen: chosenResult(store.backtest) ?? null,
      // T-290: wherever the test return is shown, the live record sits beside it (public, as on Results)
      proof: siteProof({ backtest: store.backtest, ledger: store.ledgerSummary, since: store.ledgerSince }),
    };
    return Response.json(body);
  });
