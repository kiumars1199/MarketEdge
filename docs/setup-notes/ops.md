# Ops setup (Lane O)

Hosting, data pipeline, monitoring and email. Do the steps in order. Every env var named here is listed,
empty, in `apps/web/.env.example` (block `# --- Lane O ---`). Never paste a key into a file in the repo.

How the pieces fit:

```
Engine container (Railway, or Fly)            GitHub Actions refresh.yml (every 2 h, fallback)
  scan every SCAN_EVERY_SEC (default 120 s), update+fit+grade hourly,   same engine run → data checks → `live` branch
  backtest daily 06:00 UTC
  → data checks → private Supabase bucket `scan`
                         │                                     │
                         ▼                                     ▼
            Vercel web app: DATA_SOURCE=supabase → GitHub `live` → last good copy in memory
```

A scan that fails the data checks (docs/12) is never uploaded: the web app keeps serving the previous one.

---

## 1. Supabase Storage bucket `scan`

Supabase project is created by the accounts lane (docs/setup-notes for Lane L). Use region **us-east-1**
to sit next to Vercel `iad1`.

1. Supabase dashboard → **Storage** → **New bucket**. Name `scan`. **Public bucket: OFF.**
   Or SQL editor: `insert into storage.buckets (id, name, public) values ('scan', 'scan', false);`
2. Add **no** storage policies for it. Only the service role key (server and engine) can read or write;
   the browser never sees this bucket.
3. Storage → Settings: file size limit at least 50 MB (`markets.json` is about 20 MB).
   Objects are stored **gzip-compressed under their usual names** (`markets.json`, `flags-prev.json`, ...;
   T-277, `ops/upload.py`), Content-Type `application/gzip`, no Content-Encoding. Readers sniff the gzip magic
   bytes `1f 8b` (`lib/data/store.ts` `decodeBody`, `upload.py` `get_json`), so plain objects from an older
   uploader still read. To inspect one: download it and `gunzip -c markets.json | head` (or `zcat`).
   Rollout order: the web loader must be live before the new uploader runs (an old web build can't read gzip).
4. Copy **Project URL** and the **service_role** key (Project Settings → API). They go to Vercel (step 4)
   and the engine (step 2). The service key bypasses row-level security: server-side only, never
   `NEXT_PUBLIC_`.

## 2. Engine container — Railway (primary)

Why Railway: one always-on service, a volume, deploy on push. Fly works the same (below). Both run
`ops/scheduler.py`, a single loop, so jobs never overlap and never write the same files at once.
Platform cron is not used: Fly schedules are hourly at best, and Railway allows one cron per service.

1. railway.com → New Project → **Deploy from GitHub repo** → this repo. Railway reads `railway.json`
   (Dockerfile `engine/Dockerfile`, start `python ops/scheduler.py`, always restart, 1 replica).
   It redeploys only when `engine/`, `pipeline/`, `ops/` or `config/` change.
2. Service → **Volumes** → add a volume mounted at **`/app/data`** (5 GB is plenty). Without it every
   restart re-downloads market history (about 1 hour) and loses the flag ledger. `output/` lives on the
   same volume; on a fresh volume the ledger continues from the copy baked into the image.
3. Service → **Variables**:
   - `SUPABASE_URL` = Supabase Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key
   - `BACKTEST_HOUR_UTC` = `6` (optional)
4. Service → Settings → Networking: **no public domain** (the engine serves nothing).
5. Deploy. The first run bootstraps history (~1 hour), then backtest, update, fit, grade, scan, upload.
   Logs show `[scheduler] scan: ...` and `uploaded flags.json`. Check the bucket has 6–8 JSON files.
6. Resources: 1 GB RAM is enough; raise to 2 GB if logs show the backtest being killed. Cost about $5/month.

Egress: the engine only needs `gamma-api.polymarket.com`, `clob.polymarket.com`
and your Supabase host. Neither Railway nor Fly enforces an egress allow-list on these plans; the image
has no other secrets and no listening ports (docs/15).

Non-root: the image starts as root only so `ops/scheduler.py` can take ownership of the root-owned volume,
then drops to uid 10001 before any job runs.

### Alternative: Fly.io

```bash
fly launch --no-deploy --copy-config --config fly.toml     # keeps app name kismet-engine, region iad
fly volumes create engine_data --size 5 --region iad --config fly.toml
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... --config fly.toml
fly deploy --config fly.toml
fly logs --config fly.toml
```

`fly.toml` has no `[http_service]`: no public ports. Keep exactly one machine (`fly scale count 1`).

## 3. GitHub: fallback data branch and CI

1. Repo → Settings → Actions → General → Workflow permissions: **Read and write**. `refresh.yml` pushes
   the `live` branch and opens an issue when a refresh or data check fails.
2. Fine-grained token for the web app: github.com/settings/personal-access-tokens → **Only this repo**,
   permission **Contents: Read-only**, nothing else. This is `GITHUB_DATA_TOKEN` (step 4).
3. Branch protection on `main`: require the `web-ci / web` and `web-ci / python` checks.
4. Settings → Code security: turn on **Dependabot alerts** and **security updates** (`.github/dependabot.yml`
   already schedules weekly version PRs). Optional: run `gitleaks detect` over the history once.

Note on the history cache: each run saves under a new key; restore picks the newest by prefix. Old caches
expire after 7 days unused.

## 4. Vercel (web app)

1. vercel.com → Add New → Project → import the repo.
2. **Root Directory: `apps/web`**. Framework: Next.js (also set in `apps/web/vercel.json`). Node 22.
   `vercel.json` sets `pnpm install --frozen-lockfile`, region `iad1`, and the two crons.
3. **Plan:** Hobby is non-commercial and only allows **daily** crons; a deploy with the 5-minute alerts
   cron is rejected there. Use **Pro** when charging customers (docs/14 §4). To test on Hobby first,
   change `/api/alerts/run` to `"0 8 * * *"` in `apps/web/vercel.json` on a branch.
4. Environment variables (Production; Preview gets the same except where noted):

   | Var | Value |
   |---|---|
   | `DEMO_MODE` | `false` in production (`true` keeps the no-login demo) |
   | `DATA_SOURCE` | `supabase` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (mark **Sensitive**) |
   | `GITHUB_DATA_TOKEN` | token from step 3.2 (Sensitive) |
   | `GITHUB_DATA_REPO` / `GITHUB_DATA_REF` | `<owner>/<repo>` of this GitHub repo / `live` |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your domain>` |
   | `CRON_SECRET` | `openssl rand -hex 32` (Sensitive). Vercel sends it as `Authorization: Bearer …` |
   | `HEALTH_MAX_DATA_AGE_MIN` | `30` (use `150` while only the 2-hourly GitHub fallback runs) |
   | `UNSUBSCRIBE_SECRET` | `openssl rand -hex 32` (Sensitive). Rotating it breaks old unsubscribe links |
   | `RESEND_API_KEY`, `EMAIL_FROM` | step 7 |
   | `NEXT_PUBLIC_SENTRY_DSN` | step 5 |
   | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | step 6 |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | step 8 |

   Stripe and Supabase anon key: see the accounts lane notes.
5. Domains → add your domain, follow the DNS records Vercel shows.
6. Check: `https://<domain>/api/health` returns 200 with `"db":"ok"` and `"data":{"source":"supabase",…}`.
   Cron routes return 401 without the secret:
   `curl -i https://<domain>/api/alerts/run` → 401;
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/alerts/run` → 200.

## 5. Sentry (errors)

1. sentry.io → Create project → **Next.js**. Copy the DSN → `NEXT_PUBLIC_SENTRY_DSN` (a DSN is not secret).
2. Project Settings → Security & Privacy: **Data Scrubber ON**, **Use Default Scrubbers ON**,
   **Prevent Storing of IP Addresses ON**.
3. The app already strips emails, cookies, auth headers, request bodies and query strings before
   sending (`lib/telemetry.ts`), sends no default PII, and does no tracing. Empty DSN = Sentry is off
   and not even loaded.
4. Alerts → create an issue alert "new issue → email". Source maps are not uploaded (no build plugin);
   add `withSentryConfig` + `SENTRY_AUTH_TOKEN` later if stack traces need original line numbers.

## 6. PostHog (analytics, cookieless)

1. posthog.com → new project (US or EU cloud). Copy the **Project API key** → `NEXT_PUBLIC_POSTHOG_KEY`;
   host → `NEXT_PUBLIC_POSTHOG_HOST` (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
2. Project settings: **Discard client IP data ON**, session replay **OFF**, autocapture **OFF**,
   heatmaps **OFF** (the client forces these off too).
3. The client keeps everything in memory (no cookies, no localStorage), so no cookie banner is needed
   (docs/14 §3). Each page load is a new anonymous visitor; counts are visits, not people.
4. Events (T-64): `$pageview` (URL without query string; market ids replaced by `[id]`),
   `filter_used` (`filters`: which filter fields are set, never their values), `preset_saved` (`count`),
   `upgrade_clicked` (`feature`), and for the billing lane to add: `checkout_started` / `checkout_completed`
   (`plan`, `interval`) via `track()` from `lib/telemetry.ts`. Only allow-listed properties are sent;
   anything with `@` is dropped. Never pass market data or emails.
5. Funnel: Insights → Funnel: `$pageview` path `/pricing` → `upgrade_clicked` → `checkout_started` → `checkout_completed`.

## 7. Resend (email) with SPF, DKIM, DMARC

1. resend.com → Domains → Add `mail.<your domain>` (a subdomain keeps the root domain's reputation separate).
2. Add the DNS records Resend shows, at your registrar:
   - **SPF**: TXT on `send.kismetodds.com` `v=spf1 include:amazonses.com ~all` and the MX record it lists.
   - **DKIM**: TXT `resend._domainkey.kismetodds.com` with the key Resend gives.
   - **DMARC**: TXT `_dmarc.<domain>` → `v=DMARC1; p=none; rua=mailto:[[SUPPORT_EMAIL]]`.
     After two weeks of clean reports, change to `p=quarantine`.
   Wait for "Verified".
3. API Keys → create a **Sending access** key for this domain → `RESEND_API_KEY` in Vercel.
   `EMAIL_FROM` = `Kismet <noreply@kismetodds.com>`.
4. **Magic links** do not use our code: Supabase sends them. Supabase → Authentication → Emails →
   **SMTP Settings** → enable custom SMTP: host `smtp.resend.com`, port `465`, user `resend`,
   password = a second Resend sending key, sender `Kismet <noreply@kismetodds.com>`.
   Raise Auth → Rate limits → emails per hour once custom SMTP is on.
5. Alert emails go through `lib/email` (`sendEmail` + `alertEmail`). Every one has the
   `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers and an unsubscribe
   link in the body (`/api/unsubscribe?t=<signed token>`). The link removes email from that alert rule.
   If marketing emails are ever added, they also need the operator's mailing address (CAN-SPAM).

## 8. Upstash Redis (rate limits, used by Lane X)

1. upstash.com → Create Database → Redis, region **us-east-1**, type Regional, free tier.
2. Copy **REST URL** and **REST Token** → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` in Vercel.

## 9. Uptime monitor

Better Stack (or UptimeRobot), free plan:
1. HTTP monitor `https://<domain>/api/health`, every 3–5 min, alert when status is not 200.
   It turns 503 when no data is loaded, the database is unreachable, or the scan is older than
   `HEALTH_MAX_DATA_AGE_MIN` minutes. The body says which (`data.stale`, `db`, `stripe`).
2. Second monitor on `https://<domain>/api/meta` (docs/12 launch checklist).
3. Alert by email (and phone push if you want). Optional: a public status page.

## 10. Deploy and roll back

**Web (Vercel).** Every PR gets a Preview deployment; merging to `main` deploys Production.
Roll back: Vercel → Deployments → pick the last good one → **Promote to Production** (instant, no rebuild),
or `vercel rollback`. Env var changes need a redeploy to take effect.

**Engine (Railway).** Pushing engine/ops changes to `main` redeploys. Roll back: Railway → service →
Deployments → last good → **Redeploy**. Fly: `fly releases --config fly.toml`, then
`fly deploy --image <previous image ref> --config fly.toml`.

**Data.** A bad scan cannot be uploaded (data checks). To pull the current scan anyway, delete the files
in the `scan` bucket: the web app falls back to the GitHub `live` branch within 2 minutes. The engine's
next good scan refills the bucket.

**Database.** Migrations are owned by the accounts lane. Supabase Pro has daily backups; on Free, schedule
a nightly `pg_dump` before taking payments (docs/14 §5).

**Checks before calling a deploy good:** `/api/health` 200, the home page lists markets, the status page
shows a scan from the last 30 minutes, Sentry shows no new issues.
