# Prompts to paste into Claude Code (one agent per lane)

Start each agent in a fresh clone of `<owner>/<repo>` of this GitHub repo on its own branch.
Lanes B → C → D share the web app: start B first; C and D can start once T-11, T-13, T-14 are merged
(or have C/D mock the API with `apps/web/test/fixtures` until then).

## Lane B + C (one agent: web foundation + screener) — demo critical path
```
Read CLAUDE.md, then docs/README.md, 02, 03, 04, 06, 07 and 10-tasks.md.
Build tasks T-10, T-11, T-12, T-13, T-14, T-60, then T-20 to T-29, in that order, one PR each
(branch per task, named "T-xx: title"). Use DATA_SOURCE=local reading ../../output, LocalRepo,
tier forced to "pro". Follow the data contract in docs/03 exactly; validate with zod.
After each task run pnpm test; after T-29 add Playwright flows S1–S3 from docs/12.
Do not change engine/ or pipeline/ except to fix a bug you can prove with a failing test.
When finished, write a short STATUS.md listing what works, what's stubbed, and known issues.
```

## Lane D (user features)
```
Read CLAUDE.md, docs/03 §3, 04 (Presets), 05 (F-07..F-13, F-17..F-19, F-27) and 10-tasks.md Lane D.
Build T-30, T-31, T-32 first (demo), then T-33..T-39. Use the lib/repo interface (LocalRepo now,
SupabaseRepo later). Add Playwright flows S4, S5. One PR per task.
```

## Lane A (engine)
```
Read CLAUDE.md and the repo README.md (engine), docs/05 F-29, docs/07, docs/10 Lane A.
Build T-02..T-08 in order. Keep output backward compatible: only add fields; update
docs/03 and apps/web/lib/types.ts in the same PR when you add fields. Run pytest -q engine/tests.
Never let a backtest train on rows at or after the fold start; add an assertion test.
```

## Lane E (paid)
```
Read CLAUDE.md, docs/03 §3, 08, 05 (F-11, F-12, F-21..F-23, F-28), 10 Lane E.
Build T-40..T-48. Supabase migrations in supabase/migrations; Stripe in test mode; Vercel Cron for
/api/alerts/run with CRON_SECRET. Enforce entitlements server-side. Add Playwright S7, S8.
```

## Lane F (extension) — after Lane E T-44
```
Read CLAUDE.md, docs/09, 10 Lane F. Build T-50..T-55 in apps/extension (MV3, Vite + CRX).
Reuse UI components from apps/web where possible. Do not scrape prices from the page; only the slug.
Test on 5 Polymarket event pages (NFL, soccer, weather, crypto, politics) and record screenshots.
```

## Review loop (you + me after each batch)
1. Pull the branch, `pnpm dev`, click through S1–S6.
2. Paste issues back as a numbered list; the agent fixes them in the same PR.
3. Merge, move to the next task.
