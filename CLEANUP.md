# Cleanup audit (T-256 to T-258)

Tools: `knip` 6 and `depcheck` in `apps/web` and `apps/extension`, `vulture --min-confidence 80` over
`engine pipeline ops`, plus `git grep` for TODO/FIXME, env vars and doc links. Tool output was treated as leads;
every row below was checked by grep before anything changed. No behaviour change: same pages, same output, same tests.

## Removed or merged

| What | Flagged by | Why it was safe |
|---|---|---|
| `apps/web/components/shell/Placeholder.tsx` (file) | knip: unused file | `git grep Placeholder` finds no import; only hits are the word "Placeholders" in AUDIT.md. Scaffold from T-10, replaced by real pages. |
| `matchesTopic` in `apps/web/lib/taxonomy.ts` | knip: unused export | Defined once, referenced nowhere (`git grep matchesTopic` = the definition only). |
| `DISCLAIMER` in `apps/extension/src/format.ts` | knip: unused export | Never imported or used in the extension; the popup and side panel carry the disclaimer as text in their HTML, which is unchanged. |
| `export default UpgradeGate` in `apps/web/components/UpgradeGate.tsx` | knip: duplicate export | Every importer uses the named export (`FilterPanel.tsx`, `UpgradeGate.test.tsx`); no default import or dynamic import of the file. The component itself is unchanged. |
| `export { SLUG_URL }` re-export in `apps/web/lib/search/index.ts` | knip: unused export | Its only consumer, `SearchCombobox.tsx`, imports `SLUG_URL` from `lib/search/parse`; `index.ts` still uses it locally. |
| `type Screener` in `apps/web/components/screener/useScreener.ts` | knip: unused exported type | Unused once un-exported (eslint no-unused-vars); `git grep "Screener\b"` hits only comments elsewhere. |
| `export` keyword on 41 symbols used only inside their own file (web: `LazySignupsChart`, `label`, `CloseButton`, `useBandLine`, `LOWER_CONFIDENCE_HELP`, `ORDER_STYLE_KEY`, `PLANS`, `pillsFor`, `stateFrom`, `SIMPLE_SORTS`, `snapshotOf`, `bucket`, `closesAt`, `userTz`, `fetchBacktest`, `findNode`, `planSearch`, `executionOk`, `groupByEvent`, `SearchPlan`, `CSV_COLS`, `kalshiBase`, `COLLECTIONS`, `tokenize`, `Entity`, `SETTINGS_TTL_MS`, `ph`, `BUILTIN_VIEWS`, `Counts`, `ChipKind`, `Fold`, `EdgeBucket`, `TileKey`, and `Side` from the `lib/api.ts` type re-export; extension: `DEV_KEY`, `DEV_EXTENSION_ID`, `KALSHI_DEMO_HOST`, `DASH`, `norm`, `labels`, `StakeRow`) | knip: unused exports / types | Each symbol is still used in its own file; no other file, test, script or dynamic import names it (per-symbol `git grep -w`, and knip with its Next.js, Vitest and Playwright plugins). `tsc --noEmit` and eslint pass in both apps. `Side` stays importable from `lib/types`, where every consumer already gets it. |
| Three copies of `usd()` (`app/pricing/page.tsx`, `app/terms/page.tsx`, `components/pricing/Plans.tsx`) merged into `usd` in `lib/format.ts` | grep (duplicate logic) | Same expression moved verbatim, so output is identical. New test in `lib/format.test.ts`: `169.99 → "$169.99"`, `12 → "$12"`, and that `money()` would give `$170` (why `money()` was not reused). |
| Two copies of `when(iso)` (`app/admin/audit/page.tsx`, `app/admin/health/page.tsx`) merged into `utcWhen` in `lib/format.ts` | grep (duplicate logic) | Same expression moved verbatim; pages import it as `when`, so call sites are unchanged. New test: `"2026-11-18T15:04:00Z" → "Nov 18, 2026, 3:04 PM UTC"`. `/status` has its own `when(unix)` with a `—` fallback (different input), so it stays. |
| `docs/LANE_RULES.md` | grep (unreferenced doc) | Nothing links to it (`git grep LANE_RULES` = no hits). It gives the overnight multi-lane build's process rules (start worktrees from `origin/final`, per-lane ports, "the lead merges your branch", "do NOT edit SETUP.md"), which no longer apply: the lanes are merged (STATUS.md) and the product rules it repeats live in CLAUDE.md and OVERNIGHT.md. |
| Stale line in `docs/README.md` ("Status as of Nov 16 … app not started") | grep (stale doc) | The app is built; the line now points to STATUS.md. |

## Checked and kept

| What | Flagged by | Why kept |
|---|---|---|
| `apps/web/scripts/screenshots.mjs` | knip: unused file | Dev tool run by hand; documented in `docs/screenshots/final/README.md`. |
| `eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss` | knip / depcheck: unused devDependencies | Loaded by string: `compat.extends("next/core-web-vitals", "next/typescript")` in `eslint.config.mjs`, `@import "tailwindcss"` in `app/globals.css`, the plugin in `postcss.config.mjs`. |
| `fid` in `engine/tests/test_backfill.py:52` | vulture (100%) | A stub lambda's parameter that must match `fetch_prices.history`'s signature; not dead code, and tests are not weakened. Vulture had no other finding at 80%. |
| Exports in `lib/types.ts`, `lib/schemas.ts`, `lib/repo/types.ts` (`LedgerEntry`, `LedgerStats`, `PaysBandRecord`, `ModelNodeLevel`, `Flag`, `ModelLevel`, `Json`, `AlertKind`, …) | knip: unused exports / types | Data contract: these mirror `docs/03-data-model.md` (CLAUDE.md rule 1). |
| Exports in billing, auth, trading, CSV-injection, telemetry-scrub, execution and repo files (`lib/billing/stripe.ts`, `lib/auth/terms.ts`, `lib/trade/*`, `components/trade/TradeButton.tsx`, `lib/csv.ts`, `lib/telemetry.ts`, `lib/execution.ts`, `lib/repo/server.ts`, extension `src/kalshi/sign.ts`, `src/kalshi/trade.ts`) | knip: unused exports / types | Every one is used inside its file, so it is not dead code; the audit does not touch security, billing or trading files for a cosmetic change. |
| `Logo` in `components/shell/Header.tsx` | knip: unused export | File is being edited on main by another agent. |
| `DISCLAIMER` copies in `components/shell/Footer.tsx` and `lib/email/templates.ts` | grep (duplicate) | Footer.tsx is off limits in this pass; the email copy is tested on its own in `test/email.test.ts`. |
| Env vars in `apps/web/.env.example` and `ops/preflight.mjs` | grep | All 41 are read by code (`git grep -w` per name across apps, engine, pipeline, ops, workflows). None removed. |
| `docs/setup-notes/lane-s.md` | grep (unreferenced doc) | Unlinked, but everything it says is still true (`/flags` redirect, "More filters" sheet, `lib/search/parse.test.ts`). |

TODO / FIXME / XXX / HACK: `git grep -nE "\b(TODO|FIXME|XXX|HACK)\b"` finds none in code or docs, so there was nothing to resolve.
No always-on or always-off flags found (`const X = true|false`, `if (true)`, `&& false`): none.
