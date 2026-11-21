"""Price the live bets the way the backtest prices history, and compare.

For every settled live bet (first flag per market side) this fetches, from Polymarket's public APIs, the market
(Gamma: closedTime, endDate, gameStartTime) and the hourly price history of its YES token (CLOB), then rebuilds
the backtest's view of the same bet exactly as pipeline/fetch_prices.snapshot + engine/backtest.flag_mask do:

    ref_bt  = min(closedTime, endDate, gameStartTime)          (pipeline/fetch_closed.market_rows)
    p_hist  = last history price at or before ref_bt - h, side 1 = 1 - p   (h = the bet's live horizon bucket)
    cost_bt = p_hist + fee(p_hist) + max(0.005, median live spread / 2)    (engine/backtest.slippage)

and compares it with what the live ledger paid (ask + fee). Same bets, same outcomes: the difference is purely the
price basis. Also counts how often the backtest's clock (closedTime first) differs from the live clock
(endDate / gameStartTime only, engine/scan.py).

    python3 scripts/ledger/replay_prices.py ledger.jsonl spreads.json cache_dir
"""
import json
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from common import first_flags, graded, horizon, load  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
FEE = {"crypto": 0.07, "sports": 0.05, "finance": 0.04, "politics": 0.04, "culture": 0.05, "weather": 0.05,
       "tech": 0.04, "geopolitics": 0.0}


def http(method, url, body=None):
    for i in range(4):
        try:
            req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                         headers={"content-type": "application/json", "user-agent": "ledger-research"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if i == 3:
                raise
            time.sleep(1 + i)


def ts(s):
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    if len(s) == 10:
        s += "T00:00:00+00:00"
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def cached(cache, name, fn):
    p = os.path.join(cache, name)
    if os.path.exists(p):
        return json.load(open(p))
    d = fn()
    json.dump(d, open(p, "w"))
    return d


def snapshot(pts, target, start, h):
    """pipeline/fetch_prices.snapshot for one horizon."""
    pts = sorted(pts, key=lambda x: x["t"])
    tol = max(1800, min(0.5 * h * 3600, 13 * 3600))
    best = None
    for p in pts:
        if p["t"] <= target:
            best = p
        else:
            break
    if not best or target - best["t"] > tol or (start and best["t"] < start):
        return None
    if len({p["p"] for p in pts if p["t"] <= target}) < 3:
        return None
    return float(best["p"]) if 0 < float(best["p"]) < 1 else None


def main(ledger_p, spreads_p, cache):
    os.makedirs(cache, exist_ok=True)
    rows = [e for e in first_flags(graded(load(ledger_p)))]
    spreads = json.load(open(spreads_p))
    ids = sorted({e["id"] for e in rows})
    with ThreadPoolExecutor(6) as ex:
        mk = dict(zip(ids, ex.map(lambda i: cached(cache, f"m{i}.json", lambda: http("GET", f"{GAMMA}/markets/{i}")), ids)))
    toks = {i: json.loads(m.get("clobTokenIds") or "[]") for i, m in mk.items()}
    yes = [t[0] for t in toks.values() if len(t) == 2]
    hist = {}
    for k in range(0, len(yes), 20):
        chunk = yes[k:k + 20]
        d = cached(cache, f"h{k}.json", lambda: http("POST", f"{CLOB}/batch-prices-history",
                                                     dict(markets=chunk, interval="max", fidelity=60)))
        hist.update(d.get("history") or {})
    out, clock_diff, missing = [], 0, 0
    for e in rows:
        m = mk[e["id"]]
        t = toks.get(e["id"]) or []
        h = horizon(e)
        refs = [ts(m.get(k)) for k in ("closedTime", "endDate", "gameStartTime")]
        live_refs = [r for r in refs[1:] if r]
        ref_bt = min(r for r in refs if r)
        if live_refs and abs(ref_bt - min(live_refs)) > 3600:
            clock_diff += 1
        pts = hist.get(t[0]) if len(t) == 2 else None
        start = ts(m.get("startDate")) or ts(m.get("createdAt"))
        p = snapshot(pts or [], ref_bt - h * 3600, start, h) if h else None
        if p is None:
            missing += 1
            continue
        p = p if e["side_index"] == 0 else 1 - p
        fee = FEE.get(e["category"], 0.05) * p * (1 - p)
        mt = "moneyline" if e["category"] == "sports" else "yes/no"
        sp = spreads.get(f"{e['niche']}|{mt}") or {}
        slip = max(0.005, (sp.get("median") or 0) / 2)
        won = e["result"] == "won"
        out.append(dict(cat=e["category"], won=won, h=h, live_cost=e["ask"] + e["fee"], ask=e["ask"],
                        p_hist=p, bt_cost=p + fee + slip, early=(ref_bt < min(live_refs) - 3600) if live_refs else False))
    print(f"settled first-flag bets {len(rows)}; replayed {len(out)}; no history snapshot {missing}; "
          f"backtest clock differs from live clock by >1h: {clock_diff}")

    def summ(name, xs):
        if not xs:
            return
        n = len(xs)
        w = sum(x["won"] for x in xs)
        lc = sum(x["live_cost"] for x in xs)
        bc = sum(x["bt_cost"] for x in xs)
        d = [x["ask"] - x["p_hist"] for x in xs]
        print(f"  {name:22s} n={n:4d} won={100 * w / n:5.1f}%  live ask {100 * sum(x['ask'] for x in xs) / n:5.1f}c "
              f"vs history price {100 * sum(x['p_hist'] for x in xs) / n:5.1f}c (ask-hist mean {100 * sum(d) / n:+.2f}c, "
              f"median {100 * sorted(d)[n // 2]:+.2f}c) | ROI live {100 * (w - lc) / lc:+6.1f}%  "
              f"ROI at backtest pricing {100 * (w - bc) / bc:+6.1f}%")
    summ("all", out)
    for c in sorted({x["cat"] for x in out}):
        summ(c, [x for x in out if x["cat"] == c])
    for h in sorted({x["h"] for x in out}):
        summ(f"horizon {h}h", [x for x in out if x["h"] == h])
    summ("clock: closed early", [x for x in out if x["early"]])
    summ("clock: same", [x for x in out if not x["early"]])


if __name__ == "__main__":
    main(*sys.argv[1:])
