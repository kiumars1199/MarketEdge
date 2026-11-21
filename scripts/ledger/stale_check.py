"""Are the backtest's snapshot prices tradeable, or stale? Calibration of the history price at ref - h.

For every market in the live ledger (settled, so we know the outcome) take the history price the backtest would
store at each horizon (pipeline/fetch_prices.snapshot, backtest clock ref = min(closedTime, endDate,
gameStartTime)), for both sides, keep prices inside the Best-bet range 60-95c, and compare the average price with
how often that side won. A tradeable, honest price wins about as often as it costs; a price that wins far more often
than it costs is a price you could not have bought at (a stale last trade or a wide book's mid after the outcome
was effectively known). The live ask for those bets is printed alongside where the bet was flagged.

    python3 scripts/ledger/stale_check.py ledger.jsonl cache_dir   (cache from replay_prices.py)
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from common import graded, load  # noqa: E402
from replay_prices import cached, http, snapshot, ts, CLOB, GAMMA  # noqa: E402


def main(ledger_p, cache):
    rows = graded(load(ledger_p))
    out = {}
    for e in rows:
        out[e["id"]] = (1 if (e["result"] == "won") == (e["side_index"] == 0) else 0, e["category"])
    ids = sorted(out)
    mk = {i: cached(cache, f"m{i}.json", lambda i=i: http("GET", f"{GAMMA}/markets/{i}")) for i in ids}
    toks = {i: json.loads(m.get("clobTokenIds") or "[]") for i, m in mk.items()}
    yes = [t[0] for t in toks.values() if len(t) == 2]
    hist = {}
    for k in range(0, len(yes), 20):
        chunk = yes[k:k + 20]
        d = cached(cache, f"h{k}.json", lambda chunk=chunk: http("POST", f"{CLOB}/batch-prices-history",
                                                                 dict(markets=chunk, interval="max", fidelity=60)))
        hist.update(d.get("history") or {})
    agg = defaultdict(lambda: [0, 0.0, 0])
    for i, (yes_won, cat) in out.items():
        t = toks.get(i) or []
        if len(t) != 2:
            continue
        m = mk[i]
        ref = min(r for r in (ts(m.get(k)) for k in ("closedTime", "endDate", "gameStartTime")) if r)
        start = ts(m.get("startDate")) or ts(m.get("createdAt"))
        for h in (1, 6, 24, 72, 168):
            p = snapshot(hist.get(t[0]) or [], ref - h * 3600, start, h)
            if p is None:
                continue
            for price, won in ((p, yes_won), (1 - p, 1 - yes_won)):
                if 0.60 <= price < 0.95:
                    a = agg[(cat, h)]
                    a[0] += 1
                    a[1] += price
                    a[2] += won
    print("history price at ref - h, sides priced 60-95c: avg price vs how often it won")
    for (cat, h), (n, ps, w) in sorted(agg.items()):
        print(f"  {cat:8s} {h:4d}h n={n:4d} avg price {100 * ps / n:5.1f}c won {100 * w / n:5.1f}%  "
              f"(won minus price {100 * (w - ps) / n:+5.1f} pts)")


if __name__ == "__main__":
    main(*sys.argv[1:])
