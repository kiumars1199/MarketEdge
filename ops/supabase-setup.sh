#!/usr/bin/env bash
# Supabase project setup (ops/ship.md step 6): link, apply migrations, run the RLS tests, create the private `scan`
# bucket, then print the dashboard settings that have no CLI. Dry run unless --yes. Safe to re-run: link and db push
# are no-ops when already done, and the bucket step only makes sure `scan` exists, is private and allows 50 MB files.
#
#   ops/supabase-setup.sh <project-ref> [--env apps/web/.env.prod] [--yes]
#
# Needs (for --yes): the supabase CLI (brew install supabase/tap/supabase), `supabase login`, the database password
# (asked for, or SUPABASE_DB_PASSWORD), and NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env file.
set -euo pipefail
cd "$(dirname "$0")/.."

REF="" ENV_FILE="apps/web/.env.prod" YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --dry-run) YES=0 ;;
    --env) ENV_FILE="$2"; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) REF="$1" ;;
  esac
  shift
done
if ! [[ "$REF" =~ ^[a-z]{20}$ ]]; then
  echo "usage: ops/supabase-setup.sh <project-ref> [--env apps/web/.env.prod] [--yes]" >&2
  echo "The project ref is the 20 letters in https://<ref>.supabase.co (Project settings → General)." >&2
  exit 2
fi

DOMAIN=$(node -e 'process.stdout.write(require("./config/site.json").domain || "<your domain>")')
env_value() {   # value of $1 in the env file ("" if the file or key is missing)
  [ -f "$ENV_FILE" ] || return 0
  node -e 'const e=require("util").parseEnv(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(e[process.argv[2]]||"")' "$ENV_FILE" "$1"
}

if [ $YES = 1 ]; then echo "Applying to Supabase project $REF"; else echo "Dry run (add --yes to apply) for Supabase project $REF"; fi
cat <<EOF
  1. supabase link --project-ref $REF      (asks for the database password unless SUPABASE_DB_PASSWORD is set)
  2. supabase db push                      (applies supabase/migrations/*.sql not yet applied; shows them first)
  3. supabase test db --linked             (pgTAP RLS checks, supabase/tests; one transaction, rolled back)
  4. Storage API: make sure bucket "scan" exists, private, 50 MB file limit (key from $ENV_FILE)
EOF

checklist() {
  cat <<EOF

By hand in the Supabase dashboard (no CLI for these). Project: https://supabase.com/dashboard/project/$REF
  [ ] Authentication → URL Configuration: Site URL = https://$DOMAIN
      Redirect URLs: https://$DOMAIN/auth/callback and http://localhost:3030/auth/callback
  [ ] Authentication → Providers → Email: enabled; Email OTP expiration = 900 seconds (15 minutes)
  [ ] Authentication → Providers → Google: enabled, Client ID + Client secret from Google Cloud
      (OAuth client redirect URI: https://$REF.supabase.co/auth/v1/callback; docs/setup-notes/lane-l.md §2)
  [ ] Authentication → Emails → SMTP Settings: custom SMTP on, host smtp.resend.com, port 465, user resend,
      password = a Resend sending key, sender Kismet <login@mail.$DOMAIN> (docs/setup-notes/ops.md §7)
  [ ] Authentication → Rate Limits: keep on; raise emails per hour once custom SMTP works
  [ ] Storage → Settings: global upload limit at least 50 MB (markets.json is about 20 MB)
  [ ] Advisors → Security Advisor: run it, fix anything marked error
  [ ] Database → Backups: Pro daily backups, or schedule a nightly pg_dump (LAUNCH_TODO.md #7)
EOF
}

if [ $YES = 0 ]; then checklist; exit 0; fi

command -v supabase >/dev/null || { echo "supabase CLI not found: brew install supabase/tap/supabase, then supabase login" >&2; exit 2; }
URL=$(env_value NEXT_PUBLIC_SUPABASE_URL); URL=${URL%/}
KEY=$(env_value SUPABASE_SERVICE_ROLE_KEY)
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE first." >&2; exit 2; }
case "$URL" in *"$REF"*) ;; *) echo "NEXT_PUBLIC_SUPABASE_URL ($URL) is not project $REF." >&2; exit 2 ;; esac

# supabase link / db push read supabase/config.toml; `supabase init` writes the CLI's own defaults (local only).
[ -f supabase/config.toml ] || { echo "== supabase init (local config file only)"; supabase init; }
echo "== 1. supabase link"; supabase link --project-ref "$REF"
echo "== 2. supabase db push"; supabase db push
echo "== 3. supabase test db --linked"
supabase test db --linked || echo "   WARN: RLS tests did not run or failed. They need Docker; see the output above."

echo "== 4. bucket scan"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
umask 077
printf 'Authorization: Bearer %s\napikey: %s\nContent-Type: application/json\n' "$KEY" "$KEY" > "$tmp/h"   # key stays out of argv
body='{"id":"scan","name":"scan","public":false,"file_size_limit":52428800}'
code=$(curl -sS -o "$tmp/out" -w '%{http_code}' -X POST "$URL/storage/v1/bucket" -H @"$tmp/h" -d "$body")
if [ "$code" = 200 ]; then echo "   created"
elif grep -qiE 'already exists|duplicate|409' "$tmp/out"; then echo "   exists"
else echo "   FAIL: create returned HTTP $code: $(cat "$tmp/out")" >&2; exit 1; fi
code=$(curl -sS -o "$tmp/out" -w '%{http_code}' -X PUT "$URL/storage/v1/bucket/scan" -H @"$tmp/h" -d '{"public":false,"file_size_limit":52428800}')
[ "$code" = 200 ] || { echo "   FAIL: update returned HTTP $code: $(cat "$tmp/out")" >&2; exit 1; }
curl -sS -o "$tmp/out" "$URL/storage/v1/bucket/scan" -H @"$tmp/h"
if grep -qE '"public" *: *false' "$tmp/out"; then echo "   private: yes"; else echo "   FAIL: bucket scan is not private: $(cat "$tmp/out")" >&2; exit 1; fi
checklist
