#!/usr/bin/env bash
# T-295: Lighthouse mobile (default form factor + throttling) on each path; prints LCP, CLS, TBT, FCP, TTFB (ms).
#   BASE=http://localhost:3211 OUT=/tmp/lh scripts/perf/lighthouse.sh / /bets /pricing /track-record
# CHROME_PATH defaults to the preinstalled Chromium. JSON reports are kept in $OUT.
set -euo pipefail
BASE="${BASE:-http://localhost:3211}"
OUT="${OUT:-${TMPDIR:-/tmp}/lh}"
CHROME="${CHROME_PATH:-/opt/pw-browsers/chromium}"
RUNS="${RUNS:-1}"
mkdir -p "$OUT"
printf '%-15s %3s %7s %6s %6s %6s %6s %6s\n' path run perf LCP CLS TBT FCP TTFB
for p in "$@"; do
  for i in $(seq 1 "$RUNS"); do
    name=$(echo "$p" | tr '/?=&' '____')
    f="$OUT/lh${name}-$i.json"
    npx -y lighthouse@12.8.2 "$BASE$p" --quiet --output=json --output-path="$f" --only-categories=performance \
      --chrome-path="$CHROME" --chrome-flags="--headless=new --no-sandbox" >/dev/null 2>&1 || { echo "$p lighthouse failed"; continue; }
    node -e '
      const r = require(process.argv[1]); const a = r.audits; const v = (k) => a[k]?.numericValue;
      const ms = (x) => x == null ? "-" : Math.round(x);
      console.log([process.argv[2].padEnd(15), String(process.argv[3]).padStart(3), String(Math.round(r.categories.performance.score * 100)).padStart(7),
        String(ms(v("largest-contentful-paint"))).padStart(6), (v("cumulative-layout-shift") ?? 0).toFixed(3).padStart(6),
        String(ms(v("total-blocking-time"))).padStart(6), String(ms(v("first-contentful-paint"))).padStart(6),
        String(ms(v("server-response-time"))).padStart(6)].join(" "));
    ' "$f" "$p" "$i"
  done
done
