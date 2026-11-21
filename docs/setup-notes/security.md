# Security setup (Lane X)

Owner steps for the controls in `docs/15-security.md`. The evidence map is `docs/SECURITY_EVIDENCE.md`.

## Env vars (Vercel, Production and Preview)

| Var | Needed | What happens without it |
| --- | --- | --- |
| `DEMO_MODE` | Leave unset or set to `false` in production | Unset in production means live mode, which is the safe default. Only the exact value `true` turns demo on. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | **Required in production** | Rate limits and the 5,000 rows/hour anomaly log turn off, and each instance logs a warning. Create a free Upstash Redis database and use the REST URL and token. |

## Vercel Firewall (dashboard: Project > Firewall)

The project has no code-level way to set managed rulesets, so set them by hand once:

1. **Bot Management > Bot Protection**: set to **Challenge**. Use **Log** for the first day if you want to watch first.
2. **Bot Management > AI Bots**: set to **Deny**. This duplicates the middleware 403 (`apps/web/lib/bots.ts`) at the edge, before an invocation is billed.
3. **Rules > WAF Managed Rulesets > OWASP Core Ruleset**: turn on and set to Deny. This needs the Enterprise plan; on lower plans, skip it. Input validation in the app (zod `.strict()` on every route) still applies.
4. Click **Review Changes**, then **Publish**.

CLI equivalent (Vercel CLI, run from the linked project):

```bash
vercel firewall rules update bot-protection --action challenge --yes
vercel firewall rules update ai-bots --category ai-crawlers --action deny --yes
vercel firewall publish --confirm-name <project>
```

## Vercel BotID

- On by itself on Vercel. `next.config.ts` wraps the config with `withBotId` only when `VERCEL` is set, and the browser runs `initBotId` for the same routes.
- Protected routes: market and flag lists, market and event detail, suggest, order book, magic-link sign-in, and Stripe checkout. A request that BotID marks as a bot (and not a verified bot) gets 403.
- Off Vercel (local, CI, e2e), `checkBotId()` is not called, so requests pass.
- `/api/events/by-slug/*` is not protected because the Chrome extension calls it, and the extension cannot run the BotID challenge. It is still rate limited.

## Signed URLs

None exist. The browser never fetches data files directly. The server reads the Supabase bucket with the service key, or reads the GitHub `live` branch. Keep the bucket **private**.

## Vendored picomatch (GHSA-fc5q-39xc-vjpf)

- **Advisory:** https://github.com/advisories/GHSA-fc5q-39xc-vjpf (CVE-2026-112366, high). picomatch up to 4.0.7
  has a ReDoS in single-branch repeated extglobs such as `+(*)` and `+(*a)`. There is no patched release.
- **Why we vendor it:** `pnpm audit` must show no high or critical (prod in `apps/web`, full in `apps/extension`).
  picomatch 4 reaches us through `@sentry/nextjs` (`@rollup/plugin-commonjs`, `@sentry/cloudflare > vite > tinyglobby`)
  and, in the extension, through `vitest > vite`.
- **Upstream state (checked 2026-11-17):** no fix is merged. The newest master commit is `9fab7bf619` (2026-08-27,
  globstar work). Fix PRs are open and unmerged: https://github.com/micromatch/picomatch/pull/194 (its own notes say
  `+(*a)` stays exponential) and #254 to #266. So option (b) from the audit brief applies: a minimal fix of our own.
- **The fix:** `vendor/picomatch` is picomatch 4.0.7 (MIT, `LICENSE` kept) with one change in `lib/parse.js`
  (search for "Kismet patch"). A `+(...)`/`*(...)` branch that holds a wildcard `*` is no longer repeated:
  - one plain branch (no `/`, groups, braces, escapes or negated brackets) is emitted once: `+(*a)` becomes
    `(?:[^/]*?a)` instead of `(?:[^/]*?a)+`. Such a language is closed under concatenation, so the matches are the
    same. A differential run against 4.0.7 (60 pattern/option pairs × 19,531 subjects up to 6 characters, with `/`
    and `.`) found no difference on these shapes;
  - any other branch with a `*` (several branches, braces, negated brackets) is treated like the shapes picomatch
    already refuses (`*(*|a)`): matched literally. This changes matching for those rare patterns, by design.
  - Version `4.0.8-kismet.1`. Tests: `node --test vendor/picomatch/test` (the PoC under a 200 ms bound; unpatched,
    `+(*)` took 79 s) and `apps/web/test/picomatch-redos.test.ts` (lockfiles point at the vendored copy).
- **Wiring:** `"picomatch@4": file:../../vendor/picomatch` under `overrides` in `apps/web/pnpm-workspace.yaml` and
  `apps/extension/pnpm-workspace.yaml`, plus `"picomatch@2"` in the web app: 2.3.2 came in through eslint-config-next >
  fast-glob > micromatch (dev only) and is just as affected. The 4.x API covers what micromatch uses; fast-glob and
  micromatch were checked against the vendored copy (same file counts and matches), and eslint still reports a planted
  error. The one audit line left in the web app is a moderate minimatch advisory, also eslint-only (below the
  high/critical bar). On Vercel (Root Directory `apps/web`), keep "Include files outside the Root Directory" on (the
  default) so `vendor/` is there at install.
- **Dropping it:** when picomatch ships a release that fixes the advisory, delete the override lines and
  `vendor/picomatch`, run `pnpm i` in both apps, and confirm `pnpm audit` stays clean.
