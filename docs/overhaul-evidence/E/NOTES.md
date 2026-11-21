# Lane E evidence (T-296): results and the live record

Findings and numbers are in `docs/research/live-vs-backtest.md`:
- §1–4: reconciliation, findings, the filter, the US record.
- §5: thin history.
- §7: the re-run at the ask, held-out filters, results per event.
- §8: the proof text before and after.

Scripts are in `scripts/ledger/*.py` (python3).

## Before / after, in numbers
| | Before | After |
|---|---|---|
| Proof line (/pricing, /about, llms.txt, MCP, /track-record), live-branch data | "Testing on 1 year of past markets: best bets, +14% per bet. Live since Nov 17: 742 settled bets, +1.3%, enough to compare with testing." | "In testing on past markets from Nov 30, 2025 to Nov 14, 2026, 86% of bets in the last 2 weeks: best bets, +14% per bet. Live since Nov 17: 742 settled bets, +1.3%." (No "enough" call until US bets settle; needs ~10 US events.) |
| "Enough to compare" basis | Bets: 16,896 × (2 ÷ 34.7)² = 56 bets, so 742 bets read as "enough" | US events: 2,871 test events × (2 ÷ 34.7)² ≈ 10 events, on the US record only |
| Test priced at | Mid + max(0.5¢, ½ median live spread): mean 12.21¢ over the history price | Option `taker_price: "ask"`, calibrated from 593 live asks (median +1.05¢): mean 12.02¢. Local rebuild, all folds: +2.1% → +1.9% per bet, +0.9% → +1.9% per event, t 0.80 → 0.71 |
| Filters | Chosen on the live ledger (§3) | Chosen on older folds (Nov 19, 2025 to Sep 16, 2026). On the newest 8 weeks: 23 events, −19.1% per event, t −0.81. Too few to judge. "Validated" selects nothing |
| Share of test best bets in the last 2 weeks | 86.5% (live-branch run), 87% (production) | 0.9% on the evenly sampled rebuild. Cause not confirmed on production; owner action in §5 |

## Screenshots of /track-record
| File | Data |
|---|---|
| `before-track-record-{390x844,1440x900}[-full].png` | `test/fixtures`, the page as on `overhaul` 3f92f0a |
| `after-track-record-{390x844,1440x900}[-full].png` | `test/fixtures`. There is no `ledger_summary.json`, so the live cards show their empty state |
| `after-realledger-track-record-{390x844,1440x900}[-full].png` | Fixtures plus the real `live`-branch `backtest.json`, the live ledger re-graded on Nov 20, and its summary from the merged `engine/ledger.summarize` (no US rows and no `vs_same_payout` yet, so no same-payout card) |

```bash
cd apps/web
DATA_SOURCE=local DATA_DIR=test/fixtures DATA_CLOCK=scan DEMO_MODE=true pnpm build
DATA_SOURCE=local DATA_DIR=test/fixtures DATA_CLOCK=scan DEMO_MODE=true pnpm exec next start -p 3221
node --input-type=module - after < ../../scripts/ledger/shoot.mjs           # Chromium /opt/pw-browsers/chromium
# real-ledger set: same, DATA_DIR=<scratch dir>, port 3222, PW_PORT=3222, prefix after-realledger
```

## What changed on the page
- The top cards, in order:
  1. **Live on Polymarket US**: settled bets, events, return. Empty until US rows settle.
  2. **Kismet's picks vs other bets at the same payout**: only when `vs_same_payout` exists. It shows the difference in points only once the same-payout bets reach the events bar; the picks' event count is never shown (§4).
  3. **Live, every best bet**: each bet counted once via `first`, plus the international-only line once US rows exist.
  4. **Testing on past weeks**.

  There are 3 columns on desktop without the same-payout card and 2×2 with it. Each card has one headline number and one sentence; t-stat, cents per share, all logged rows and the full tables are in "Details".
- The proof text lives in `lib/proof.ts` and is shared by every page. `components/results/summary.ts` imports from it and no longer overrides it:
  - The span comes from `folds[]`.
  - Needs are counted in events and judged on US events only.
- The edge section title is computed. "Bets we rated higher did better" shows only when every edge group of 30+ test bets earned more than the group below. That holds on the fixture, but not on production on Nov 20 (13.1 / 14.0 / 10.2 / 16.9¢).
- No week was changed: the May week is not a proven data bug.
- Charts stay in `app/track-record/Charts.tsx`.

## Engine
- `flag_max_edge` (§3) and `taker_price` (§7) are both in `config/demo.json` and both default off (`null` / `"mid"`).
- Tests: `engine/tests/test_max_edge.py`, `engine/tests/test_ask_price.py`.

## Gates
- `pnpm lint` and `pnpm typecheck`: clean.
- `pnpm test`: 96 files, 712 tests passed, plus 36 ops tests. One test failed in both full runs: `test/api.test.ts` "apply() timing p95 < 150 ms" (490 ms and 354 ms, with load average around 16 from other lanes). Run alone, that file passed 7 of 7. This lane does not touch that code.
- engine `python3 -m pytest -q engine/tests`: 82 passed.
- e2e (`PW_PORT=3220`, `--workers=1`, specs a11y + proof + s6 + s6-tools):
  - Full run: 37 of 38 passed. The failure was `proof.spec` "group records…": the "Pays 10x+" click landed before hydration while a background backtest was loading the CPU.
  - `proof.spec` alone: one run failed only the drawer test, which has flaked before. The final run passed 6 of 6.
