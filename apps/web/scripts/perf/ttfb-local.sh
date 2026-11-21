#!/usr/bin/env bash
# T-295 (docs/OVERHAUL.md §C): local TTFB + headers against `next start` (run `next build` first).
# For each route: a fresh `next start` (cold = its first request), then 5 warm requests (median reported).
#   PORT=3211 DATA_DIR=../../output scripts/perf/ttfb-local.sh / /bets /pricing /about /track-record /terms
# Env passes through to next start (DATA_SOURCE, DATA_DIR, DEMO_MODE, DATA_CLOCK...). One line per route.
set -euo pipefail
PORT="${PORT:-3211}"
ROUTES=("$@")
[ ${#ROUTES[@]} -eq 0 ] && ROUTES=(/ /bets /pricing /about /track-record /terms)
cd "$(dirname "$0")/../.."
LOG="${TMPDIR:-/tmp}/ttfb-next-$PORT.log"
t() { curl -s -o /dev/null -w '%{http_code} %{time_starttransfer}\n' "http://localhost:$PORT$1"; }
ms() { awk -v s="$1" 'BEGIN { printf "%.0f", s * 1000 }'; }
printf '%-15s %5s %8s %8s  %-58s %s\n' route code cold_ms warm_ms cache-control x-nextjs-cache
for r in "${ROUTES[@]}"; do
  # a leftover server on the port would be measured instead of this build (next start just fails with EADDRINUSE)
  if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then echo "port $PORT already in use: stop that server first" >&2; exit 1; fi
  node node_modules/next/dist/bin/next start -p "$PORT" > "$LOG" 2>&1 &
  pid=$!
  for _ in $(seq 1 150); do grep -q "Ready" "$LOG" 2>/dev/null && break; sleep 0.2; done
  cold=$(t "$r")
  warm=$(for _ in 1 2 3 4 5; do t "$r" | cut -d' ' -f2; done | sort -n | sed -n 3p)
  hdr=$(curl -s -D - -o /dev/null "http://localhost:$PORT$r")
  cc=$(grep -i '^cache-control:' <<<"$hdr" | cut -d' ' -f2- | tr -d '\r' || true)
  xc=$(grep -i '^x-nextjs-cache:' <<<"$hdr" | cut -d' ' -f2- | tr -d '\r' || true)
  printf '%-15s %5s %8s %8s  %-58s %s\n' "$r" "${cold%% *}" "$(ms "${cold##* }")" "$(ms "$warm")" "${cc:--}" "${xc:--}"
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
done
