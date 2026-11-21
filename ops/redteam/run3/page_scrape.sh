#!/usr/bin/env bash
# RT3: anonymous enumeration through the server-rendered market page, which has no rate limit and no row budget.
# /api/markets is capped for Free (list_free 30/min, rowBudget 1,500 distinct markets/hour, RT-03) and
# /api/markets/<id> by the "markets" rule, but GET /m/<id> renders the same MarketResponse (curve + exact mid included)
# into the RSC payload with no limit at all.
# Usage: page_scrape.sh <base> <markets.json> [N=1600] [parallel=8]
set -euo pipefail
IDS=$(mktemp); trap 'rm -f "$IDS"' EXIT; B=$1 M=$2 N=${3:-1600} P=${4:-8}
python3 -I -c "import json,sys;[print(x['id']) for x in json.load(open(sys.argv[1]))['markets'][:int(sys.argv[2])]]" "$M" "$N" > "$IDS"
echo "API detail for comparison (30 calls):"
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}\n" "$B/api/markets/$(sed -n "${i}p" "$IDS")"; done | sort | uniq -c
echo "Page /m/<id> for $N distinct markets:"
start=$(date +%s)
xargs -P "$P" -I{} sh -c 'body=$(curl -s -w "\n%{http_code}" "$0/m/{}"); code=$(printf "%s" "$body" | tail -1); \
  if printf "%s" "$body" | grep -q "\\\\\"points\\\\\":\[{"; then echo "$code curve"; else echo "$code nocurve"; fi' "$B" < "$IDS" | sort | uniq -c
echo "elapsed $(( $(date +%s) - start ))s"
