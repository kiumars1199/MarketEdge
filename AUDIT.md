# Audit: OVERNIGHT §3, run 4

Final audit of Kismet, run 4.

- **Auditor:** a fresh agent that built none of this code. It changed no product code; it only checked and reported.
- **Audited commit: `bd21cc6`** (merge of `0588018` "T-280: MCP hardening" into `final`), merged fast-forward into this branch `agent/audit4`. The run began on `a6ebb65` (T-287: catch-all 404 and wording; T-280 Origin check and disclaimer wrapper). While it was running, `final` moved to `bd21cc6`, which changes only three files: `apps/web/lib/mcp/auth.ts`, `apps/web/lib/abuse.ts` and `apps/web/test/mcp.test.ts`.
- **Commit per check:** every check notes the commit it ran on.
  - **Re-run on `bd21cc6`** (the wired `:3161` server switched to the `bd21cc6` build at 07:41; labels come from evidence timestamps against that switch):
    - typecheck, lint and vitest
    - the wired production build and server
    - all MCP checks (probe, eras, plan gates), plus the batch, failed-token, expiry and outage tests
    - the signed-in crawls (Free, Pro, Premium, beta, which includes beta `/kalshi`), axe signed in, the tour, banned-word grep, hammer, API vs output, formulas, OAuth decision
  - **Ran on `a6ebb65` only:**
    - pytest, the extension tests and the two e2e suites
    - the keyless build: the signed-out crawls, Lighthouse and axe signed out
    - the 3-b hydration runs and the route matrix
    - wired `a6ebb65` (`$S/clean8`): the 3-c browser test and screenshots, paywall, trade, billing mock, robots/llms discovery, UA matrix and headers, bundle grep, legal pages, MCP parity, `/pricing` and `/account` MCP copy, the Origin host-spoof test
  - Why these were not re-run: two of the changed files are MCP auth code and tests. The third, `lib/abuse.ts`, is the shared rate-limit module, but its only change is one added rule, `mcp_bad_token` (`git diff a6ebb65 bd21cc6 -- apps/web/lib/abuse.ts`: +1 line). Site limits were still re-checked on `bd21cc6` by the hammer. No page, e2e spec (none mentions `mcp`), engine or extension code changed.
- **Date:** 2026-11-20.
- **Spec:**
  - `docs/OVERNIGHT.md` §3, items 1–11
  - the MCP brief: endpoint, tools, plan gates, robots and llms.txt, "try to break it"
  - the run 3 FAILs to re-verify: 3-b, 3-c, 10-b, MCP-a and MCP-b
  - the coordinator's scope addition for `bd21cc6`
  - also used: `CLAUDE.md`, `docs/12-test-plan.md`, `docs/15-security.md` and `docs/01-product.md` (Compliance)

**Verdicts:**
- **PASS:** checked and met.
- **FAIL:** not met. Each one gives file:line, a repro and the evidence.
- **BLOCKED:** needs something this environment can't provide: a live Supabase, Stripe, Vercel or Upstash account, or network access to Polymarket. Each one says what would unblock it.

## Setup

`$S` is the session scratchpad; it is not committed. Only ports 3160 and 3161 were used.

- **Clean clone `$S/clean6`** at `a6ebb65`:
  - a new Python venv and `pnpm i --frozen-lockfile` for web and extension
  - Node 22; pnpm 12.21.0 for web (its `packageManager`) and 10.28.0 for the extension
  - **Clean clone `$S/clean9`** at `bd21cc6`, for the re-runs.
- **Keyless production build (`$S/clean7`, `a6ebb65`):** `next build` and `next start -p 3161` under `env -i`, with `DEMO_MODE` off and no app keys (`setup/keyless-env.sh`).
  - It keeps only the sandbox proxy and CA variables, because `next/font` fetches Google Fonts at build time; without them the build fails on TLS.
  - Used for item 2, the signed-out crawls, Lighthouse, axe signed out and 3-b signed out.
- **Wired production build:** `NODE_ENV=production` with the in-repo Supabase and Stripe mock on `:3160` as the backend, and fake keys (`setup/wired-env.sh`, key bodies redacted).
  - First `$S/clean8` at `a6ebb65`, then `$S/clean9` at `bd21cc6`, each on `:3161`.
  - It is a real production server: the rate limiter is on, using the per-instance memory store.
- **E2E mock on `:3160`:** `E2E_MOCK=1 next dev` from `clean6` (`setup/mock3160.sh`). It stands in for Supabase (auth, REST, and the OAuth server for MCP tokens) and for Stripe. Its state is in memory.
- **Seeded users:** created through the mock's magic link (`setup/seed-states.mjs`): Free, Pro, Premium, a beta tester (Premium plus a live comp grant) and the admin. Storage states and cookies are not committed.
- **MCP tokens:** the mock accepts any JWT whose `sub` is a known user. So "an OAuth access token" here is a JWT with a `client_id` claim, minted by the scripts. Real issuance is BLOCKED.
- **Positive control for 3-b:** run 3's wired build at `c151ac7` (`$S/clean5`).

**Evidence:** everything is under `audit-evidence/`, replaced wholesale. Run 3's files are in git history. Scripts sit next to their output. The fake Stripe key bodies are redacted. No tokens, cookies or storage states are committed.

## Summary

| # | Item | Verdict |
|---|------|---------|
| 1 | Tests on a clean clone | PASS |
| 2 | Production build, no keys | PASS |
| 3 | Every page × every state | PASS: run 3's **3-b and 3-c are fixed** |
| 4 | Quality | PASS (Lighthouse `/` performance median exactly 90; observations) |
| 5 | Data correctness | PASS |
| 6 | Security | PASS for everything testable here; live parts BLOCKED |
| 7 | Multipliers and combos | PASS (no code change since run 3; tests green) |
| 8 | Trading safety | PASS |
| 9 | Billing | PASS on the mock; Stripe test mode BLOCKED |
| 10 | Legal and wording | PASS: run 3's **10-b is fixed**. Literal "unlock" and "guarantee" hits are listed for the owner |
| 11 | Publication readiness | PASS; engine scan and Chrome Web Store BLOCKED |
| MCP | MCP server (T-280/281, plus the `bd21cc6` hardening) | **FAIL (1: MCP-c, new in `bd21cc6`)**. Run 3's **MCP-a and MCP-b are fixed**. Real OAuth BLOCKED |

**FAILs: MCP-c.** Details are in the FAIL list at the end.

---

## Run 3 FAILs, re-verified

| Run 3 FAIL | Now | Evidence |
|---|---|---|
| **3-b** React #418 on unmatched-URL 404s, throttled | **Fixed.** Throttled (CDP 40 ms, 1.25 MB/s down, 0.5 MB/s up), on `a6ebb65`: **0 / 280** loads with any hydration message.<br>• Keyless, signed out: `/no-such-page` 60 at 1280 px and `/a/b/c` 60 at 390 px.<br>• Wired, signed in: Premium `/no-such-page` 60 and `/a/b/c` 60 at 1280 px; Free `/a/b/c` 20 at 390 px; beta `/no-such-page` 20 at 390 px.<br>• The only console error is the document's own 404.<br>• **Positive control:** the same harness on `c151ac7`, wired, Premium, found #418 in **4/40**, so it does detect the bug. At that rate, 0/280 by chance is about 1e-13.<br>• The 404s keep status 404 and `<meta name="robots" content="noindex">`.<br>• Signed out with auth on, unknown URLs still answer 307 to `/signup?next=…`, as before. | `item3/hyd-*.txt`, `item3/hyd-wired-summary.txt`, `item3/hyd-control-c151-premium.txt`, `item3/routes-*.txt` |
| **3-c** beta link to `/kalshi` was a 404 | **Fixed.** Browser test and screenshots on wired `a6ebb65`; the beta crawl on `bd21cc6` loads `/kalshi` again with 0 errors. With no `output/kalshi.json`:<br>• A beta tester reaches `/kalshi` from the header at 1440 px and from the mobile "More" dialog at 390 px. The page answers 200 with the Beta banner, h1 "Kalshi markets" and "No Kalshi data yet. It appears here after a scan with Kalshi data turned on." There are 0 console errors.<br>• Free, Pro and Premium see no link and get 404. Signed out gets 307 to sign-up. The admin (also a tester) sees the empty state.<br>• Beta `/api/kalshi` answers 404 `{"error":"Not available"}` (no data, by design); `/combos` answers 200. The beta crawl has 0 broken links out of 276. | `item3/kalshi-3c.txt`, `item3/3c-beta-{1440,390}.png`, `item3/wired-beta-summary.txt` |
| **10-b** "past picks" in the tour | **Fixed.** On `bd21cc6`, the tour's five steps show "Choose how much it pays" and "how past flagged bets actually did". The track record shows "when you choose a payout", and the filter note shows "Choosing a payout includes…". The tour has 0 banned words. | `item10/tour.txt`, `item10/tour-results-step.png`, `item10/banned-grep.txt` |
| **MCP-a** validation errors without the disclaimer | **Fixed.** Every tool result ends with the disclaimer, on both protocol eras and on `bd21cc6` as on `a6ebb65`, measured with the real MCP client SDK.<br>• Eras: legacy (negotiated `2025-11-25`) and modern (pinned `2026-07-28`).<br>• All 21 tool cases end with the disclaimer, including SDK validation errors: `limit` 0, 25.5 or "50"; `page` 1001; a bad `tier`; a bad category; `pays_min` 0; a negative `closing_within_hours`; an empty, 121-character or numeric `query`; a missing or over-long `market_id`; an extra key; and `my_list` `limit` -5 or `page` 0.<br>• `pays_min > pays_max` and an unknown market return normal results with the disclaimer.<br>• A JSON-RPC batch of 3 (invalid, valid, `track_record`) on `bd21cc6`: all 3 results end with it (`mcp/mcp-batch.txt`). A Free user sending invalid input also gets it.<br>• An unknown tool name is a JSON-RPC protocol error (`-32602`), not a tool result, in both eras.<br>• `Accept: text/event-stream` only, or `application/json` only, gives 406 at the transport level, with no tool result. | `mcp/mcp-eras-{a6ebb65,bd21cc6}.txt` (44 "ends-with-disclaimer", 0 without), `mcp/mcp-probe-*.txt` D1/D5 |
| **MCP-b** no Origin validation | **Fixed** (`app/api/mcp/route.ts:54-56`, `originValidationResponse`, checked before auth).<br>• **403:** a foreign Origin, a look-alike `kismetodds.com.evil.example`, `null`, garbage, `127.0.0.1` when the site is `localhost`, a foreign Origin with a spoofed `Host` (curl), with `X-Forwarded-Host`, and a foreign Origin with no token (so the Origin check runs before auth).<br>• **Allowed:** no Origin, the site's own Origin, and the same hostname on another port or with the other scheme (MCP observation 7). Matrix re-run on `bd21cc6`; host-spoof by curl on `a6ebb65`. | `mcp/mcp-eras-*.txt` (Origin matrix), `mcp/mcp-origin-host-spoof.txt`, `mcp/mcp-probe-*.txt` B4 |

### Regressions from the new catch-all `app/[...missing]/page.tsx`

A route matrix covers every route in the build manifest (dynamic segments filled), discovery files and unknown paths, with GET and POST. It records status, content type, cache control and robots. It compared run 3's wired build `c151ac7` with `a6ebb65`, signed out and as Premium (`item3/routes.mjs`, `item3/routes-*.txt`).

Every real page, API, metadata route, `.well-known` route, the `/flags` 308, the OG and Twitter images and the dev-mock `/v1` rewrite are unchanged. Two differences:

1. **Missing `/_next/static/*` files** now get the full HTML 404 page, rendered by the server, instead of a small `text/plain` 404, signed out and in. Next's own 404 for static assets is replaced by the catch-all.
   - Effect: a stale or missing chunk returns about 50 KB of HTML instead of a few bytes, and every bad asset request now renders the shell.
   - Low severity (observation 1).
2. **Signed in, `GET /no-such-page` with `RSC: 1`** (a client-side navigation to an unknown URL) answers **200** `text/x-component` instead of 404. The HTML request is still 404 with noindex. This is not visible to users or crawlers (observation 2).

The BotID rewrite (array rewrites run before dynamic routes, and only with `VERCEL` set) was not exercised; that needs a Vercel build.

## 1. Tests: PASS

| Check | Result | Commit |
|---|---|---|
| `pip install -r requirements.txt`, `pytest -q` | `66 passed` | `a6ebb65` |
| `pnpm i --frozen-lockfile` (web, extension) | exit 0 | both |
| `pnpm typecheck` | exit 0 | both |
| `pnpm lint` (`--max-warnings 0`) | exit 0 | both |
| `pnpm test` | **`a6ebb65`:** vitest 82 files, 547 tests; ops node tests 27/27<br>**`bd21cc6`:** 82 files, **549** tests (the 2 new MCP tests); `test/mcp.test.ts` alone 26/26 | both |
| Extension typecheck and test | exit 0, 42 tests | `a6ebb65` (extension unchanged since) |
| `pnpm e2e`, demo config | `56 passed` | `a6ebb65` |
| `pnpm e2e`, paid config (`PW_PORT=3160`) | `10 passed`, no flake this run | `a6ebb65` |

Evidence: `item1/*-a6ebb65.txt` and `item1/*-bd21cc6.txt`.

## 2. Production build, DEMO_MODE off, empty keys: PASS

On `a6ebb65`, keyless (`item2/keyless-checks.txt`, `item2/prod-build-keyless-a6ebb65.txt`):
- `next build` exits 0; `/[...missing]` is dynamic (ƒ).
- `/pricing` shows "Coming soon" ×6, with no demo or dev banner.
- The signed-out crawl had no 5xx other than `/api/book` (Polymarket is blocked).
- `/api/mcp` answers 401 "Sign-in is not configured", and both `/.well-known/oauth-protected-resource*` routes answer 404.
- `/api/health` is 503 by design without Upstash.

The wired build at `bd21cc6` also exits 0 (`item2/wired-build-bd21cc6.txt`).

## 3. Every page × every state: PASS

**How checked:** `item3/crawl.cjs` (Playwright at 390 and 1440 px, with CDP throttling: 40 ms latency, 1.25 MB/s).
- Per page it records:
  - console errors and warnings, page errors and failed requests
  - `NaN`/`undefined`/`null`/`[object Object]`/lorem/TODO/FIXME in visible text
  - banned words, the footer disclaimer and horizontal scroll
- Then every internal link is fetched.
- `item3/summ.py` writes the summaries.
- `/no-such-page` and `/a/b/c` are in the route list.

| State | Server | Page loads | Links | Broken | Evidence |
|---|---|---|---|---|---|
| Signed out | keyless prod `a6ebb65`, UTC and New York | 76 each | 64 | 0 | `item3/prod-anon-{utc,ny}-summary.txt` |
| Free | wired prod `bd21cc6` | 76 | 63 | 0 | `item3/wired-free-summary.txt` |
| Pro | wired prod `bd21cc6` | 76 | 274 | 0 | `item3/wired-pro-summary.txt` |
| Premium | wired prod `bd21cc6` | 76 | 274 | 0 | `item3/wired-premium-summary.txt` |
| Beta (Premium plus a live comp grant) | wired prod `bd21cc6` | 76 | 276 | 0 | `item3/wired-beta-summary.txt` |

After the crawls, `/api/me` confirmed every session (right email and plan; beta flag on the tester).

**In every state:**
- The disclaimer is in every footer.
- No `NaN`/`undefined`/`null`/`[object Object]`/lorem appears in visible text.
- No page scrolls horizontally at 390 px.
- The only console errors are expected:
  - **404s by design:**
    - `/admin*` for non-admins
    - `/combos` and `/kalshi` for non-testers
    - `/no-such-page` and `/a/b/c`
  - **Environment:** `/m/*` gets 502 from `/api/book` because the proxy blocks `clob.polymarket.com`. The page shows that the live order book didn't answer.

**Source:** 0 `TODO`/`FIXME` and 0 `console.log` in `app`, `components`, `lib`, `middleware.ts` and the extension `src` (tests excluded) (`item3/todo-grep.txt`).

**Observation (pre-existing, not new):** a gated route's 404 for a non-tester carries that page's static metadata in the RSC payload. So the browser tab can show "Kalshi markets · Kismet", and the payload holds the description "Kalshi prices, volume and combos…". The server `<title>` is "Page not found".
- This affects `/kalshi`, `/combos` and `/admin` (`app/kalshi/page.tsx:10`, `app/combos/page.tsx:10`). The metadata is static, so Next resolves it before `notFound()` runs.
- It names a hidden beta feature to non-testers. Use `generateMetadata` that returns the 404 metadata when `!canBeta`.
- Observation 3 in the final list.

## 4. Quality: PASS (with observations)

| Check | Result | Evidence |
|---|---|---|
| Lighthouse mobile, 5 runs, `TZ=America/New_York`, keyless `a6ebb65` | Medians (perf/a11y/BP/SEO):<br>• `/` **90**/98/100/91<br>• `/about` 94/100/100/91<br>• `/pricing` 97/100/100/91<br>Every median is ≥ 90. `/` is borderline: its 5 performance runs were 90, 92, 86, 89, 94 (LCP 2.8–3.4 s). Run 3's median of 3 was 94. | `item4/lighthouse-median.txt`, `item4/lh.sh` |
| axe, signed out, keyless (28 routes × 2 widths) | 0 serious/critical | `item4/axe-prod-anon.txt` |
| axe, signed in, wired `bd21cc6`, Free and Premium (27 routes × 2 widths each) | 0 serious/critical | `item4/axe-wired-{free,premium}.txt` |
| Keyboard-only search → drawer → save → upgrade | PASS: the e2e-paid keyboard spec (item 1) | `item1/e2e_paid-a6ebb65.txt` |
| Drawer focus trap and Escape | PASS: `e2e/a11y.spec.ts` (item 1) | `item1/e2e_demo-a6ebb65.txt` |
| `prefers-reduced-motion` | PASS in code (`app/globals.css`); code unchanged since run 2's browser check | |

**Observations:**
- axe raises moderate rules only: `heading-order` on `/`, `/bets` and `/m`, and `landmark-unique` on `/pricing`.
- SEO 91 is the `meta-description` audit.
- The design review was not repeated, because nothing visual changed except the `/kalshi` empty state; see its screenshots.

## 5. Data correctness: PASS

| Check | Result | Evidence |
|---|---|---|
| Fees and returns, 20 sampled flags (seed 4044, `bd21cc6`) | Recomputed with `pipeline.common.taker_fee`: fee, edge, edge_low and ROI match, **0 mismatches** | `item5/formulas.txt`, `item5/formulas.py` |
| API vs `output/*.json`, Pro, wired `bd21cc6` | `/api/markets?ps=50`: 168 rows and 2,352 side fields, **0 mismatches** | `item5/apicmp.txt` |
| Card vs API vs MCP (wired `a6ebb65`) | `get_market 6674492` for a Pro token matches `/api/markets/6674492` for the same plan: win chance 93%, edge, capacity $24,282, backtest record 95% / +20% / 7.5K | `mcp/mcp-parity.txt` |
| Free capped in the server response (wired `a6ebb65`) | **Free:**<br>• `/api/flags?ps=1000` gives 10 rows; `pg=2` gives page 1 and the same rows.<br>• `/api/markets?pg=99999` gives page 1.<br>• `/api/markets/:id` gives ranges only (`edge [0.2, null]`, `roi_pct [20, 50]`) and no capacity.<br>**Pro:** `pg=2` gives page 2; `pg=99999` gives 400. | `item6/paywall.txt` |
| Free delayed in the server response | Not re-run this time. The data path is unchanged since `c151ac7` (`git diff c151ac7 bd21cc6` touches no `lib/data`, filter or respond code). Run 3 passed it with the scan-clock fixture (`git show 7d603ab:audit-evidence/item5/free-delay.txt`, the run 3 audit commit). | |

## 6. Security: PASS for everything testable here; live parts BLOCKED

| Sub-check | Verdict | Evidence |
|---|---|---|
| Paid data as anon or Free through the API (wired `a6ebb65`, paced) | **PASS.**<br>• **Anon:** 401 on every data route; `/api/admin/export` 404.<br>• **Free:** 10 rows with paging ignored, ranges only; `/api/kalshi` 404.<br>• No theta or covariance anywhere.<br>• `/api/combos` returns `{"groups":[]}` to non-testers, by design (`app/api/combos/route.ts`). | `item6/paywall.txt` |
| Another user's rows with the anon key | **BLOCKED** (live Supabase). The PGlite `test/rls.test.ts` passed in item 1. | |
| Forged webhook | **PASS** (mock): a wrong secret, an unsigned body, a garbage signature and a 10-minute-old timestamp all get 400. A validly signed body claiming Premium leaves the tier at Pro. | `item9/billing-mock.txt` B1–B5 |
| Replayed webhook | **PASS:** the second delivery returns `{"duplicate":true}` | `item9/billing-mock.txt` C1–C2 |
| Rate limits (wired `bd21cc6`) | **PASS:**<br>• Premium `/api/markets` 429 at request 61 after a quiet minute.<br>• `POST /api/auth/magic-link` 429 at 6.<br>• MCP Premium refused at call 61; Pro at call 4.<br>• MCP failed tokens 429 at 32 (see MCP-c).<br>Signed out, data APIs are 401 at the account wall before any limiter (on the keyless build they limit at 31, run 3, code unchanged). Live Upstash is **BLOCKED**. | `item6/hammer.txt`, `mcp/mcp-probe-bd21cc6.txt` C2–C4, `mcp/mcp-badtoken.txt` |
| AI crawler / user-agent matrix (wired `a6ebb65`) | **PASS:**<br>• GPTBot, ClaudeBot, CCBot and Google-Extended get 403 on every page and API; `robots.txt` stays readable.<br>• ChatGPT-User, Claude-User and Perplexity-User get 200 on `/`, `/pricing`, `/about` and `/llms.txt`, and 403 on `/bets` and `/api/*`.<br>• `/api/mcp` and OAuth discovery answer any agent (`lib/bots.ts` `AGENT_OPEN`); `/oauth/consent` is 403 for agents (it is opened by a person). | `item6/ua-headers.txt`, `item6/ua-mcp.txt` |
| Headless bots | **BLOCKED** (Vercel BotID runs only on Vercel) | |
| Headers (`curl -I`) | **PASS:** nonce CSP with `strict-dynamic`, HSTS, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy; `private, no-store` on app pages and `/api/mcp` | `item6/ua-headers.txt` |
| `pnpm audit` | **PASS:** `--prod` is clean for web and extension. The full web audit has 1 moderate (minimatch via eslint, dev only); the full extension audit is clean. | `item6/pnpm-audit-*.txt` |
| `pip-audit` | **PASS:** no known vulnerabilities | `item6/pip-audit.txt` |
| gitleaks, full history | **PASS:** no leaks with `.gitleaksignore`. Without it there are 18 findings: exactly the 18 ignored fingerprints, 0 new and 0 unused ignores. This commit was scanned too (see below). | `item6/gitleaks-*.txt` |
| Client bundles | **PASS:** the keyless and wired `.next/static` have 0 hits for `SUPABASE_SERVICE_ROLE`, `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `sk_test_`, `sk_live_`, `whsec_`, `e2e-service`, `service_role`, `RESEND_API`, `UPSTASH_REDIS_REST_TOKEN`, `KISMET_ADMIN`, `CRON_SECRET`, `MCP_ALLOWED_ORIGINS` and private keys. The single `e2e-mock` hit is the middleware matcher string. `/e2e-mock/*` is 404 in prod. | `item6/bundle-grep.txt` |
| Cookies | **PASS** in run 3 on the production build (`Secure; HttpOnly; SameSite=lax`). Auth code is unchanged since, so it was not re-run (this run's magic-link probe used a wrong body). The live HTTPS domain is **BLOCKED**. | `git show 7d603ab:audit-evidence/item6/cookies-prod.txt` (run 3 audit commit) |
| OAuth consent decision (CSRF) | **PASS** on `bd21cc6`: `POST /api/oauth/decision` gets 403 with a foreign or missing Origin, 400 on a bad body, and 401 signed out. `/oauth/consent` signed out redirects to `/login?next=…`; a bad id shows "This request has expired or was already used". | `item6/oauth-cookies.txt` |

## 7. Multipliers and combos: PASS

There is no code change in this area since run 3. `git diff c151ac7 bd21cc6` touches only the catch-all, the Kalshi page, three wording lines, the MCP route and server, MCP auth and abuse rules, and tests.

The covering tests passed in item 1:
- `test/multipliers.test.ts`: a 10x bet at 14% with +4 points lands in the `edge` tier; a combo backtest that lost money hides the suggestions.
- `lib/format.test.ts`: counts round down.
- `lib/combos.test.ts`: 2- and 3-leg math; same-event legs are warned.
- The e2e `multipliers.spec.ts`.

The MCP text uses `formatCount`: "2.2K", "1K" (`mcp/mcp-parity.txt`).

## 8. Trading safety: PASS

- **Off unless configured** (wired `a6ebb65`, `item8/trade-prod.txt`):
  - The setup has `KALSHI_TRADING_ENV=demo` and an allow-listed Premium user, but no `NEXT_PUBLIC_EXTENSION_ID`.
  - `/api/trade/config` answers `enabled:false` for every plan.
  - `/api/trade/nonce` gets 403 "Bad origin." for a foreign or `chrome-extension://` Origin, 403 "Trading isn't enabled" from the site's own Origin, and 401 signed out.
- **Read-only MCP:** the 5 tools are all `readOnlyHint: true` and `destructiveHint: false`; nothing places an order.
- **Keys stay in the extension; transfer scope rejected; confirm per order; caps:** not re-run. Extension code is unchanged since `c151ac7`, where run 3 passed it (`git show 7d603ab:audit-evidence/item8/keyinspect.cjs`), and `trading-paper` e2e and `lib/trade` tests passed in item 1.

## 9. Billing: PASS on the mock; Stripe test mode BLOCKED

`item9/billing.cjs` against the mock and wired `a6ebb65` (`item9/billing-mock.txt`, this run; billing code is unchanged in `bd21cc6`):
- **A:** checkout, then signed webhooks, gives `pro` (trialing).
- **B and C:** forged and replayed webhooks, as in item 6.
- **D:** `cancel_at_period_end` keeps Pro; `subscription.deleted` at period end gives `free`.
- **E:** a Payment Link with an unsigned `client_reference_id` is ignored and the tier stays free (the webhook answers 500 so Stripe retries, as in runs 2–3); a signed one gives `pro`.
- **F:** `DELETE /api/account` cancels the Stripe subscription and signs the user out.

**BLOCKED:** Stripe test mode end to end. It needs Stripe test keys and a deployed webhook URL.

## 10. Legal and wording: PASS (literal hits listed)

| Check | Result | Evidence |
|---|---|---|
| Legal pages present and in the footer | `/terms`, `/privacy`, `/refunds`, `/disclaimer` and `/contact` all 200; the footer links them plus `/about`, `/pricing` and `/status` | `item10/item10.txt` |
| Disclaimer everywhere | Every crawled page, the extension popup and side panel, every MCP result, the `/account` MCP card and `/llms.txt` | items 3 and 11, `mcp/` |
| 18+ gate at signup | "I'm 18 or older and agree to the Terms and Privacy Policy" checkbox (API refusal tested in run 3, unchanged) | `item10/item10.txt` |
| Responsible-gambling resources on `/disclaimer` | 1-800-GAMBLER, ncpgambling, "Problem Gambling" | `item10/item10.txt` |
| Unsubscribe in every email | Unchanged since run 3, which passed it; the email template tests passed in item 1 | |
| Banned words | **PASS for the banned meanings.** The tour, filters, track record, MCP tool text, `llms.txt` and extension zip have 0 hits. The literal hits that remain are listed below for the owner. | `item10/banned-grep.txt`, crawls |

**Literal hits remaining** (the same judgment call as run 3, which listed verbs without failing them; the owner later changed those verbs anyway):
- "**Unlock** all 1K bets": `apps/web/components/screener/LockedBets.tsx:58`, shown to every Free user on `/` and `/bets`.
- "Upgrade to **unlock**": `apps/web/components/UpgradeGate.tsx:22`.
- Demo mode only:
  - "Demo: every feature is **unlocked**" (`apps/web/components/pricing/Plans.tsx:69`)
  - "Everything is **unlocked**…" (`apps/web/lib/auth/server.ts:26`)
- `/terms` "We give no **guarantee** that any estimate is right" (`apps/web/app/terms/page.tsx:103`). This disclaims a guarantee and is not a claim.
- **Why these are not FAILs:** the spec lists the words "pick / lock / guaranteed / sure thing / can't lose" (`docs/OVERNIGHT.md:19`, `docs/12-test-plan.md:31`). The repo's own checks read them as whole words: `apps/web/test/auth-email-templates.test.ts:10` uses `/\b(pick|lock|guaranteed|sure thing|can't lose)\b/i`. "unlock" doesn't match that, and it is a paywall verb, not the betting slang "a lock". If the owner reads "lock, any form" literally, use "See all 1K bets" and "Upgrade to see this".
- The remaining grep matches are code: comments, the TypeScript `Pick<>` and local `pick()` functions.
- The market data contains the player name "Benjamin Lock" (third-party data).

## 11. Publication readiness: PASS; engine scan and Web Store BLOCKED

- **robots, sitemap and llms.txt** (wired `a6ebb65`, `item11/discovery.txt`):
  - `robots.txt` disallows `/` for GPTBot, ClaudeBot, CCBot, Google-Extended and 30 more.
  - ChatGPT-User, Claude-User and Perplexity-User are allowed `/$`, `/pricing`, `/about`, `/track-record`, the legal pages and `/llms.txt`, then `Disallow: /`.
  - `*` disallows `/api/`, `/oauth`, the app pages, `/kalshi` and `/combos`.
  - The sitemap has 11 public URLs.
  - `/llms.txt` is 200 `text/markdown`, with the disclaimer, public pages, the MCP URL, tools, plans and the crawler policy.
- **No test users, seed data or debug routes in prod:** `/e2e-mock/*` 404, and no seed identities in bundles.
- **Error pages styled:** the 404 is the shell with header, footer and disclaimer; see the catch-all notes above.
- **Icons and OG images:** `/icon.svg`, `/apple-icon.png`, `/opengraph-image`, `/twitter-image` and `/m/:id/opengraph-image` all 200 (route matrix). `/favicon.ico` is 404 but not linked (observation).
- **Extension** (`item11/extension-zip.txt`, `item11/extload.cjs`):
  - Built with `KISMET_ORIGIN=https://kismetodds.com pnpm ext:zip`.
  - MV3, with permissions `storage` and `sidePanel`. Host permissions are only the site and the Kalshi demo API; `externally_connectable` is the site only; CSP `script-src 'self'`. No eval or remote code.
  - **The store zip, unzipped, loads in a fresh Chromium profile:** the service worker starts, and `popup.html` and `sidepanel.html` render with the disclaimer. The only error is that kismetodds.com is unreachable from here.
  - Chrome Web Store review is **BLOCKED**.
- **SETUP.md from scratch:** the clean clone's install, tests, build and start work (items 1–2). `python -m engine` scans fail at Polymarket (proxy block): **BLOCKED**.

---

## MCP server (T-280, T-281, plus the `bd21cc6` hardening): FAIL (1); real OAuth BLOCKED

These were checked black-box against the wired production build: `mcp/mcp-probe.mjs` (labels A1… below), `mcp/mcp-eras.mjs`, and the new failed-token and outage scripts. The probe output on `bd21cc6` is line-for-line identical to `a6ebb65` apart from a countdown (`mcp/mcp-probe-*.txt`).

### Endpoint and auth

| Check | Result |
|---|---|
| `/api/mcp`, streamable HTTP | PASS:<br>• `initialize` 200 (`2025-06-18`) with serverInfo; `tools/list` works.<br>• It answers JSON or SSE depending on `Accept`.<br>• GET and DELETE 405; OPTIONS 204 with no CORS headers.<br>• `Cache-Control: private, no-store`.<br>• Both protocol eras work through the SDK client (B1–B3, `mcp-eras`). |
| Discovery | PASS: the 401 carries `WWW-Authenticate … resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`, and the PRM lists the resource and the Supabase auth server. Both routes are 404 when Supabase is unset (item 2). |
| Missing, garbage, forged, expired, no-`exp`, Basic or empty-`client_id` tokens; a site session token as bearer; a site cookie | PASS: all 401 (A1–A9) |
| An MCP token used on the site | PASS: it counts as signed out everywhere (E1–E3) |
| Origin | PASS (MCP-b fixed, above) |
| Consent UI and decision route | PASS (item 6) |
| Real OAuth 2.1: DCR, PKCE, consent approve, token issue, refresh, revoke | **BLOCKED**: needs a Supabase project with the OAuth server on |

### Tools and rules

| Check | Result |
|---|---|
| Read-only tools `best_bets`, `search_markets`, `get_market`, `track_record`, `my_list` | PASS: all `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` |
| limit ≤ 25 | PASS: `limit` 100 returns 25 rows. General observation 5: the schema still advertises `maximum: 9007199254740991` (`lib/mcp/server.ts:126` has no `.max`). |
| Same gates as the site, no new data | PASS:<br>• `best_bets` default, `tier all` plus sports, and `search_markets "bitcoin"` return the same 25 ids in the same order, with the same totals, as `/api/flags?g=0` and `/api/markets?g=0`, for both a Premium user and a Pro user.<br>• `get_market` for Pro equals the Pro API (`mcp/mcp-parity.txt`). |
| Plans | PASS:<br>• **Free:** all tools refused, with a pricing link and the disclaimer (C1).<br>• **Pro:** calls 1–3 work; call 4 gets the upgrade message; a batch of 4 counts per call (C2, C3).<br>• **Premium:** refused at call 61, "Try again in N seconds" (C4).<br>• Live cross-instance caps are **BLOCKED** (Upstash). |
| Beta only for beta users | PASS by code and unit test (the venue shows Kalshi only with `canBeta`). The beta user gets results; the data has no Kalshi tickers, so that branch could not be exercised black-box (D8). |
| No ranking by the user's own positions | PASS: lists are the same for everyone. `my_list` keeps the saved order, with no re-ranking and no leak of another user's rows (D7). |
| Disclaimer at the end of every result | PASS (MCP-a fixed) |
| Injection inputs (SQL, regex, HTML, prompt injection, unicode, traversal) | PASS: treated as text (D4, D5) |
| `/pricing` "Use Kismet in Claude" on Premium (wired `a6ebb65`) | PASS: the Premium card says "Use Kismet in Claude, ChatGPT and Cursor (read-only connector)", and the table row reads "— / 3 calls a day / Yes" (`mcp/mcp-ui-copy.txt`) |
| `/account` setup steps (wired `a6ebb65`) | PASS: the text differs per plan (Free "Part of Premium (Pro includes 3 calls a day)", Pro "3 calls a day… Premium has no daily cap", Premium "up to 60 calls a minute"). It shows the server URL, steps for Claude, Claude Code, ChatGPT and Cursor, and the disclaimer. |
| robots.txt and `/llms.txt` | PASS (item 11) |

### `bd21cc6` delta (the coordinator's checks)

The diff adds four things:
- `lib/abuse.ts:25` `mcp_bad_token` (30 a minute)
- `lib/mcp/auth.ts:45-52`: only a 4xx from Supabase means a bad token; a throw, status 0 or 5xx is `server_error`
- `lib/mcp/auth.ts:73-86`: a per-client-key failed-token budget with an in-memory block
- two tests

| Check | Result | Evidence |
|---|---|---|
| A Supabase outage returns `server_error`, not `invalid_token` | **PASS** for connection refused: the mock was killed and 35 valid-token requests all got **500** `{"error":"server_error","error_description":"Sign-in service unavailable"}`, with no `WWW-Authenticate` header, so clients keep their tokens. A junk token during the outage also gets 500. The unit test covers status 0, 503 and a throw. | `mcp/mcp-outage.txt` 3a–3c, `item1/mcp_test-bd21cc6.txt` |
| A hung Supabase (not refused) | **MCP observation 9:** with the mock SIGSTOPped, the request had no answer after 25 s (`curl -m 25`). Nothing times out `sb.auth.getUser` (`lib/mcp/auth.ts:46`), so requests hang until the platform's function timeout. | `mcp/mcp-hang.txt` |
| 30 rejected tokens a minute per client give 429 without calling Supabase | **PASS.** Rejected tokens 1–31 get 401; the 32nd gets **429** with `Retry-After: 60` and `private, no-store`, in 6 ms. Direct proof that Supabase isn't asked: with the block active and the mock stopped or dead, requests got an instant 429 (4 ms), not the 500 or hang that a Supabase call gives. The unit test's verifier spy agrees. | `mcp/mcp-badtoken.txt` 3–5, `mcp/mcp-outage.txt` 1a–1c |
| Valid tokens never count against the budget | **PASS:** 40 valid calls and 5 calls with no token, then 30 rejected ones, still trip only at the 31st rejection | `mcp/mcp-badtoken.txt` 1–4 |
| Outages don't count | **PASS:** after 35+ outage answers, a fresh Premium user's valid token gets 200 | `mcp/mcp-outage.txt` 4 |
| Nothing in it weakens auth | **PASS:** the change only adds refusals; every request that is not blocked still goes through `requireBearerAuth` and the Supabase verifier unchanged. A spoofed `X-Forwarded-For`/`X-Real-IP` doesn't escape the block (`clientIp` ignores those off Vercel and uses `x-real-ip` from Vercel's edge on Vercel). | `mcp/mcp-badtoken.txt` 8 |
| **Valid tokens are refused while a client key is blocked** | **FAIL MCP-c** (below) | `mcp/mcp-badtoken.txt` 6–7, `mcp/mcp-expired.txt` |

### FAIL MCP-c: the failed-token block also refuses valid tokens, and ordinary token expiry trips it

- **What:** the block is checked **before** the token is verified (`apps/web/lib/mcp/auth.ts:76-77`). Once a client key has 31 rejected tokens in a minute, every request from that key gets 429 for 60 s. That includes valid Premium tokens that have used none of their 60 a minute.
- **Proved here (black-box, wired `bd21cc6`):**
  1. 31 junk tokens, then a valid Premium token: **429** `Retry-After: 60`. A request with no token is 429 too (`mcp/mcp-badtoken.txt` 6–7). The block lifts after `Retry-After`, and the valid token gets 200 again (9).
  2. **Routine expiry trips it.** 31 different real Premium users each send their own genuine token that expired 60 s earlier. This is what an assistant sends before it refreshes, and it gets 401 "Token has expired". Then a **32nd user's valid token gets 429** (`mcp/mcp-expired.txt`).
- **Why that matters (code reading, not exercised):**
  - **Off Vercel**, `clientKey` is `ip:local` for every caller (`apps/web/lib/abuse.ts:143,148-152`). So 31 failures anywhere block every MCP user of that instance.
  - **On Vercel** the key is IP plus JA4 TLS fingerprint. A hosted assistant (Claude's or ChatGPT's connector) calls from shared egress IPs with one TLS stack, so all of its users share a key.
  - Access tokens expire hourly, and an MCP client typically learns it must refresh from a 401. A few hundred active users of one assistant are likely to produce 30 expiry 401s in a minute, and then everyone on that assistant gets 429 for a minute, repeatedly. A malicious user of that assistant can trigger it on purpose with a revoked token.
  - The comment at `lib/mcp/auth.ts:73-74` names exactly this risk ("a flat per-IP cap would throttle every user of an assistant that calls from shared egress IPs"). The block reintroduces it for everyone once the failure budget is spent.
- **Also in this code (reading, not testable with the mock):** `lib/mcp/auth.ts:51` treats every 4xx from Supabase as a bad token. If Supabase rate-limits the verifier (429) or times out (408), the answer is `invalid_token`, which counts against the budget and tells clients to throw their tokens away. That is the outcome the change set out to prevent.
- **Suggested fix:**
  - Don't refuse before verifying. When a key is over budget, still verify a token that is not obviously malformed, and let a valid one through; refuse only the rejected ones (or cache recent rejected token hashes and short-circuit those).
  - Don't count `"Token has expired"`: the SDK checks `exp` locally (A6), so no Supabase call is spent on it.
  - Treat 408 and 429 from Supabase like 5xx in `verifyAccessToken`.
  - Add a test that a valid token from a key that has 31 recent expired-token failures still gets 200.
- **Severity:** medium. Paid Premium users lose the connector for a minute at a time through no fault of their own. There is no data exposure.

### MCP observations (not fails)

Run 3's observations, updated:
1. **No rate limit before auth:** **partly addressed** in `bd21cc6`. Rejected tokens are now budgeted. Requests with no `Authorization` header are still unlimited (130 → all 401), but they cost no Supabase call.
2. **No audience binding** (`expectedResource` unset): unchanged; acceptable while the project has one resource.
3. **PRM `resource` on the bare path:** unchanged.
4. **`docs/15-security.md` does not list `mcp_premium`, `mcp_pro_daily` or the new `mcp_bad_token`.**
5. **RLS "no oauth clients" policy** covers only the tables that exist when the migration runs.
6. **Supabase Auth endpoints with an app token:** BLOCKED (live project).

New this run:
7. **The Origin allow-list compares hostnames only** (`app/api/mcp/route.ts:26-31` with the SDK's `originValidationResponse`). `http://localhost:9999` and `https://<site host>` pass, as would `http://kismetodds.com:8080`. A rebinding attacker would have to serve from Kismet's own hostname, so the risk is low; comparing the full origin (scheme, host and port) would be tighter.
8. SDK input validation runs before the plan gate, so a Free user sending invalid arguments gets the validation error (with the disclaimer) rather than the Free refusal. This is harmless.
9. A hung Supabase hangs `/api/mcp` (see the delta table). Wrap `getUser` in a timeout (`AbortSignal.timeout(5000)` through `global.fetch`) and map it to `server_error`.

---

## FAIL list

| ID | File:line | Repro | Suggested fix |
|---|---|---|---|
| **MCP-c** | `apps/web/lib/mcp/auth.ts:76-77` (block checked before verification); `:79-84` (expired tokens counted); `:51` (Supabase 408/429 counted as bad tokens); key: `apps/web/lib/abuse.ts:143,148-152` | **Wired prod `bd21cc6`.**<br>• 31 junk tokens, then a valid Premium token: 429 (`mcp/mcp-badtoken.txt` 6).<br>• Or 31 real users' tokens expired 60 s ago, then a 32nd user's valid token: 429 (`mcp/mcp-expired.txt`).<br>• Scripts: `mcp/mcp-badtoken.mjs`, `mcp/mcp-expired.mjs`. | • Verify before refusing, and let valid tokens through a blocked key.<br>• Don't count locally detected expiry.<br>• Treat Supabase 408/429 as `server_error`.<br>• Add a test for a valid token after 31 expired-token failures. |

Run 3's FAILs 3-b, 3-c, 10-b, MCP-a and MCP-b are fixed (see the re-verification table).

## BLOCKED list

| What | Unblock with |
|---|---|
| Real Supabase OAuth 2.1: DCR, PKCE, consent approve, token issue, refresh and revoke, AS discovery | A Supabase project with the OAuth server enabled, the site deployed, and a real MCP client (a Claude connector or `claude mcp add`) |
| MCP-c's real blast radius: how many assistant users share one IP+JA4 key, and how often their tokens expire | A Vercel deploy, a hosted connector, and logs of `mcp_bad_token` hits |
| RLS against a real `client_id` token; another user's rows with the anon key; pgTAP `supabase/tests/rls.test.sql` | A Supabase project or the local Supabase CLI (`supabase db test`) |
| Whether an app token can call Supabase Auth's own endpoints (`PUT /auth/v1/user`) | A live Supabase project |
| Cross-instance rate limits: Pro 3/day, Premium 60/min, `mcp_bad_token`, site limits | `UPSTASH_REDIS_REST_*` on a deploy with more than one instance |
| Headless-bot defence (BotID), and the BotID rewrite against the new catch-all | A Vercel deploy with BotID and Bot Protection |
| Stripe test mode end to end | Stripe test keys and a deployed webhook endpoint |
| Cookies on the real HTTPS domain | A deploy (flags already observed on the production build) |
| Chrome Web Store review | Store submission |
| Engine scan (`python -m engine all`) and `/api/book`, the live order book | Network access to `gamma-api.polymarket.com` and `clob.polymarket.com` |

## Observations (not fails)

1. **Catch-all:** missing `/_next/static/*` files now get the full HTML 404 page (server-rendered) instead of a `text/plain` 404. That is more bytes and more server work per bad asset request (`app/[...missing]/page.tsx`).
2. **Catch-all:** signed in, an `RSC: 1` request for an unknown path answers 200 instead of 404. The HTML request is 404.
3. Gated routes (`/kalshi`, `/combos`, `/admin`) carry their static page title and description in the RSC payload of the non-tester 404, and the browser tab shows that title. This is pre-existing (item 3).
4. Lighthouse `/` performance median is exactly 90, with 2 of 5 runs under 90. SEO 91 is `meta-description`. axe shows moderate rules only.
5. MCP `LIMIT` schema advertises `maximum: 9007199254740991` (`lib/mcp/server.ts:126`), while results are clamped to 25.
6. The keyless build fetches Google Fonts at build time (`next/font`), so an offline or proxied CI needs the proxy CA.
7. Literal "unlock" and "guarantee" wording (item 10), for the owner to decide.
8. `/favicon.ico` is 404 (not linked; `/icon.svg` serves).
9. An unsigned Payment Link checkout leaves a webhook answering 500 for Stripe's retry window (`RetryLater`), as in runs 2–3.
10. MCP observations 1–9 above.
11. The machine is shared with other worktrees' servers and test runs. During the outage test the kernel OOM-killed the stopped mock, so the hang test was repeated separately (`mcp/mcp-hang.txt`). No other check was affected (the e2e suites ran solo in item 1).
12. `item3/routes-keyless.txt` was made with an earlier version of `routes.mjs` whose "[404 UI]" marker matched every page. Ignore that column there; the status, type and robots columns are valid.
