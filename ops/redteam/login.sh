#!/usr/bin/env bash
# Sign in on the E2E_MOCK dev server and optionally buy a plan through the in-app Stripe mock.
# Usage: ops/redteam/login.sh http://localhost:3410 <email> <jar> [pro_monthly|premium_monthly]
set -euo pipefail
B=$1 EMAIL=$2 JAR=$3 PLAN=${4:-}
rm -f "$JAR"
curl -s -c "$JAR" -b "$JAR" -H "Origin: $B" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"accept\":true}" "$B/api/auth/magic-link" >/dev/null
LINK=$(curl -s "$B/e2e-mock/supabase/_inbox?email=$EMAIL" | python3 -c 'import json,sys;print(json.load(sys.stdin)["url"])')
curl -s -c "$JAR" -b "$JAR" -o /dev/null "$LINK"
if [ -n "$PLAN" ]; then
  URL=$(curl -s -c "$JAR" -b "$JAR" -H "Origin: $B" -H 'content-type: application/json' -d "{\"price\":\"$PLAN\"}" "$B/api/stripe/checkout" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["url"])')
  curl -s -o /dev/null "$URL"
fi
curl -s -b "$JAR" "$B/api/me"; echo
