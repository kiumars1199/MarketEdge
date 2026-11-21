#!/usr/bin/env bash
# T-295 (docs/OVERHAUL.md §C): read-only speed check of the live site's signed-out pages, for the owner after a deploy.
#   ops/perf-prod.sh [base_url]          (default https://kismetodds.com)
#   LH=0 ops/perf-prod.sh                skip Lighthouse
#   CHROME_PATH=/path/to/chromium        Chromium for Lighthouse (default: /opt/pw-browsers/chromium if present)
# Each page is fetched twice (no cookies): the second answer should come from the edge, x-vercel-cache HIT or STALE,
# with a public cache-control. Then Lighthouse mobile (performance) per page: LCP, CLS, TBT. GETs only; nothing is written.
set -euo pipefail
BASE="${1:-https://kismetodds.com}"
BASE="${BASE%/}"
PAGES=(/ /pricing /about /track-record /terms /privacy)
OUT="${OUT:-$(mktemp -d)}"

printf '%-16s %-4s %-6s %-9s %-10s %s\n' page try status ttfb_ms x-vercel cache-control
for p in "${PAGES[@]}"; do
  for try in 1 2; do
    hdr="$OUT/hdr$(echo "$p" | tr '/' '_')_$try.txt"
    t=$(curl -s -o /dev/null -D "$hdr" -w '%{http_code} %{time_starttransfer}' -H 'user-agent: kismet-perf-check' "$BASE$p")
    code=${t% *}; ttfb=$(awk -v s="${t#* }" 'BEGIN { printf "%d", s * 1000 }')
    vc=$(grep -i '^x-vercel-cache:' "$hdr" | tr -d '\r' | cut -d' ' -f2- || true)
    cc=$(grep -i '^cache-control:' "$hdr" | tr -d '\r' | cut -d' ' -f2- || true)
    printf '%-16s %-4s %-6s %-9s %-10s %s\n' "$p" "$try" "$code" "$ttfb" "${vc:--}" "${cc:--}"
  done
done
echo "raw headers: $OUT"

[ "${LH:-1}" = "0" ] && exit 0
CHROME="${CHROME_PATH:-}"
[ -z "$CHROME" ] && [ -x /opt/pw-browsers/chromium ] && CHROME=/opt/pw-browsers/chromium
echo
printf '%-16s %-5s %-8s %-6s %s\n' page perf lcp_ms cls tbt_ms
for p in / /pricing /track-record; do
  json="$OUT/lh$(echo "$p" | tr '/' '_').json"
  npx -y lighthouse@12.8.2 "$BASE$p" --quiet --only-categories=performance --form-factor=mobile \
    --output=json --output-path="$json" ${CHROME:+--chrome-path="$CHROME"} \
    --chrome-flags="--headless --no-sandbox" >/dev/null 2>&1 || { echo "$p lighthouse failed"; continue; }
  node -e '
    const r = require(process.argv[1]), a = r.audits;
    console.log([process.argv[2].padEnd(16), String(Math.round(r.categories.performance.score * 100)).padEnd(5),
      String(Math.round(a["largest-contentful-paint"].numericValue)).padEnd(8),
      a["cumulative-layout-shift"].numericValue.toFixed(3).padEnd(6), Math.round(a["total-blocking-time"].numericValue)].join(" "));
  ' "$json" "$p"
done
