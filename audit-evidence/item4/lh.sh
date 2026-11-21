S=/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad
export TZ=America/New_York
export CHROME_PATH=$S/pw/chromium-1255/chrome-linux64/chrome
mkdir -p $S/r4/lh
for page in / /about /pricing; do for i in 1 2 3; do
  n=$(echo $page | tr -c 'a-z\n' '_')$i
  echo "$(date +%T) load=$(cut -d' ' -f1-3 /proc/loadavg) $page run $i"
  $S/lh/node_modules/.bin/lighthouse "http://localhost:3161$page" --quiet --chrome-flags="--headless --no-sandbox" --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=$S/r4/lh/$n.json >/dev/null 2>&1 || echo "lh failed $page $i"
done; done
