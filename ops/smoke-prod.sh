#!/usr/bin/env bash
# Post-deploy smoke checks (SETUP.md §4, ops/ship.md step 12). Prints PASS/FAIL per check; exit 1 if any fail.
# Read-only apart from a burst of ~40 log-only POSTs to /api/ext/telemetry, which spends this machine's own rate
# limit for that route group for one minute. Never calls a cron route with the secret (that would send alerts).
#
#   ops/smoke-prod.sh https://kismetodds.com [--dry-run]
#
# Optional env:
#   CRON_SECRET=...           also check /api/health details: db ok, data source supabase, rate limiting on
#   SMOKE_EXPECT_HEALTH=503   expected /api/health status (default 200; 503 for a local production build without Upstash)
# If checks return 403 with x-vercel-mitigated, the Vercel Firewall challenged curl: run this before turning on
# Bot Protection, or add a bypass rule for your IP.
set -uo pipefail

BASE="" DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,12p' "$0"; exit 0 ;; *) BASE="${a%/}" ;; esac; done
[[ "$BASE" =~ ^https?://[^/]+$ ]] || { echo "usage: ops/smoke-prod.sh https://<domain> [--dry-run]" >&2; exit 2; }

CHECKS="GET /api/health → ${SMOKE_EXPECT_HEALTH:-200}${CRON_SECRET:+ (+ details with CRON_SECRET)}
GET / → CSP, HSTS, X-Frame-Options DENY, Referrer-Policy, X-Content-Type-Options nosniff
GET /api/alerts/run and /api/settle/run without the secret → 401
GET /robots.txt → 200 with a Sitemap line; GET /sitemap.xml → 200 urlset
og:image on / → fetches as an image
GET /admin and /api/admin/export anonymously → 404
GET /e2e-mock/... → 404
GET /api/meta → 200
40 × POST /api/ext/telemetry → at least one 429"
if [ $DRY = 1 ]; then echo "Would check $BASE:"; echo "$CHECKS" | sed 's/^/  - /'; exit 0; fi

UA="kismet-smoke/1"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pass=0 fail=0
result() { if [ "$1" = 0 ]; then echo "PASS  $2"; pass=$((pass + 1)); else echo "FAIL  $2${3:+  ($3)}"; fail=$((fail + 1)); fi; }
# fetch <path> [curl args...]: body → $tmp/body, headers → $tmp/head, prints the status code
fetch() { local p="$1"; shift; curl -sS -A "$UA" --max-time 20 -o "$tmp/body" -D "$tmp/head" -w '%{http_code}' "$@" "$BASE$p" 2>/dev/null || echo 000; }
expect() { local want="$1" path="$2"; shift 2; local got; got=$(fetch "$path" "$@"); [ "$got" = "$want" ]; result $? "$path → $want" "got $got"; }

echo "Smoke checks against $BASE"
expect "${SMOKE_EXPECT_HEALTH:-200}" /api/health
if [ -n "${CRON_SECRET:-}" ]; then
  umask 077; printf 'Authorization: Bearer %s\n' "$CRON_SECRET" > "$tmp/auth"   # secret stays out of argv
  fetch /api/health -H @"$tmp/auth" >/dev/null
  for want in '"db":"ok"' '"source":"supabase"' '"ratelimit":"on"'; do
    grep -q "$want" "$tmp/body"; result $? "/api/health details $want" "$(head -c 300 "$tmp/body")"
  done
fi

code=$(fetch /)
result $([ "$code" = 200 ]; echo $?) "/ → 200" "got $code"
if grep -qi '^x-vercel-mitigated' "$tmp/head"; then echo "      note: the Vercel Firewall challenged this request (see the header of this script)"; fi
cp "$tmp/body" "$tmp/home"
for h in 'content-security-policy:' 'strict-transport-security: max-age=' 'x-frame-options: deny' 'referrer-policy:' 'x-content-type-options: nosniff'; do
  grep -qi "^$h" "$tmp/head"; result $? "header ${h%%:*}"
done

expect 401 /api/alerts/run
expect 401 /api/settle/run

code=$(fetch /robots.txt)
[ "$code" = 200 ] && grep -qE '^Sitemap: https?://[^ ]+/sitemap\.xml' "$tmp/body"; result $? "/robots.txt → 200 with Sitemap" "got $code"
code=$(fetch /sitemap.xml)
[ "$code" = 200 ] && grep -q '<urlset' "$tmp/body"; result $? "/sitemap.xml → 200 urlset" "got $code"

og=$(grep -oE '<meta property="og:image" content="[^"]+"' "$tmp/home" | head -1 | sed -e 's/.*content="//' -e 's/"$//' -e 's/&amp;/\&/g')
if [ -z "$og" ]; then result 1 "og:image meta on /" "no og:image tag"
else
  got=$(curl -sS -A "$UA" --max-time 20 -o /dev/null -w '%{http_code} %{content_type}' "$og" 2>/dev/null || echo 000)
  [[ "$got" =~ ^200\ image/ ]]; result $? "og:image $og → image" "got $got"
fi

expect 404 /admin
expect 404 /api/admin/export
expect 404 /e2e-mock/stripe/v1/products
expect 404 /e2e-mock/supabase/_inbox
expect 200 /api/meta

codes=""
for _ in $(seq 1 40); do
  codes="$codes $(fetch /api/ext/telemetry -X POST -H 'Content-Type: application/json' --data '{"kind":"no_rows","slug":"smoke-test","markets":0}')"
done
n429=$(echo "$codes" | tr ' ' '\n' | grep -c '^429$')
[ "$n429" -gt 0 ]; result $? "rate limit: 40 × POST /api/ext/telemetry → 429 after the burst" "$(echo "$codes" | tr ' ' '\n' | sort | uniq -c | xargs)"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
