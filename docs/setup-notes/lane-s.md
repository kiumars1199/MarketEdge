# Lane S: search and simple filters (T-70..T-75)

No keys, no env vars, no owner values. Everything runs in DEMO_MODE on the fixture.

- New dependency: `minisearch@7.2.0` (pinned exact). Server only: `lib/search/index.ts` is built with the store.
- `/` is now Best bets; the old landing is `/about` ("How it works" in header and footer). `/flags` redirects
  to `/` permanently (next.config.ts).
- New route `GET /api/suggest?q=&tz=&view=`: q at most 120 chars (400 above), at most 9 rows, `Cache-Control: private, max-age=30`.
- New URL keys: `x0`/`x1` (pays min/max, max exclusive), `wp1` (win chance max), `tz` (sent with `q` so
  "today"/"tomorrow" use the viewer's timezone), sort `s=pays.desc` (Biggest payout, edge >= 2¢ only).
- The full filter panel is now the "More filters" sheet (`f` still toggles it). There is no sidebar.
- Fixture: the Wales vs Portugal Nations League event is renamed RCD Mallorca vs FC Barcelona (La Liga) so the
  docs/13 Barcelona examples have data. Counts are unchanged.
- Tests: `pnpm test` (parser table in `lib/search/parse.test.ts`, index/facets in `test/search.test.ts`),
  `PW_PORT=3120 pnpm e2e e2e/search.spec.ts`. The full e2e suite on `next dev` is green with `--workers=1`;
  with several workers, cold route compiles can time out random specs.
