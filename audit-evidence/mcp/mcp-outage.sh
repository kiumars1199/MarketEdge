#!/bin/bash
# Run 4 (bd21cc6): Supabase outage behaviour on /api/mcp, black-box. The wired prod server (:3161) uses the in-repo
# mock on :3160 as Supabase. Steps (advisor-ordered so the in-memory mock state survives until the last step):
#  1. trip the failed-token block, SIGSTOP the mock, send one request -> an instant 429 proves Supabase isn't asked
#  2. block lapsed, mock still stopped (hung Supabase): valid token with curl -m 25 -> hang or server_error?
#  3. SIGCONT; kill the mock (connection refused): ~35 valid-token requests -> expect 5xx server_error, not 401 invalid_token
#  4. restart the mock, reseed a Premium user -> 200, not 429 (outage answers did not count against the budget)
S=/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad; R=$S/r4; W=http://localhost:3161
TOK=$(cat $R/premium.mcptoken)
mcp() { curl -s -m "${2:-25}" -o $R/o.txt -D $R/h.txt -w '%{http_code} %{time_total}s' -X POST $W/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' -H "authorization: Bearer $1" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'; echo " | www=$(grep -i '^www-authenticate' $R/h.txt | cut -c1-140 | tr -d '\r') | $(head -c 120 $R/o.txt)"; }
MOCK=$(pgrep -f "next-server" | while read p; do [ "$(readlink /proc/$p/cwd)" = "$S/clean6/apps/web" ] && echo $p; done | head -1)
echo "# $(date -u +%FT%TZ) mock next-server pid=$MOCK"
echo "0. valid token, mock up: $(mcp $TOK)"
for i in $(seq 1 31); do curl -s -o /dev/null -X POST $W/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "authorization: Bearer junk$i" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'; done
echo "1a. after 31 junk tokens, mock up: $(mcp junk-more)"
kill -STOP $MOCK
echo "1b. mock SIGSTOPped, junk token while blocked: $(mcp junk-more2 10)"
echo "1c. mock SIGSTOPped, valid token while blocked: $(mcp $TOK 10)"
sleep 62
echo "2. block lapsed, mock still SIGSTOPped (hung Supabase), valid token, curl -m 25: $(mcp $TOK 25)"
kill -CONT $MOCK; sleep 2
echo "2b. mock resumed, valid token: $(mcp $TOK)"
pkill -f "clean6/apps/web/node_modules/.bin/../.pnpm/next@" ; kill $MOCK 2>/dev/null; pkill -f "next dev -p 3160"
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3160/ || break; sleep 1; done
codes=""; for i in $(seq 1 35); do codes="$codes $(curl -s -o /dev/null -w '%{http_code}' -X POST $W/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "authorization: Bearer $TOK" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"; done
echo "3a. mock killed (connection refused), 35 valid-token requests: $(echo $codes | tr ' ' '\n' | sort | uniq -c | tr '\n' ' ')"
echo "3b. one more, full answer: $(mcp $TOK)"
echo "3c. junk token during outage: $(mcp junk-outage)"
nohup bash $R/mock3160.local.sh > $R/logs/mock-restart.log 2>&1 &
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3160/e2e-mock/supabase/auth/v1/settings)" != "000" ] && break; sleep 1; done
echo "4. mock restarted (state wiped); reseeding one Premium user"
node $R/sc/mcp-after-outage.mjs
