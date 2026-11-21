"""Does the backtest's price series know the outcome? A check on the live bets, where we know the real ask.

For every settled live bet (first flag per side) we read the CLOB hourly history the backtest uses
(pipeline/fetch_prices: batch-prices-history, fidelity 60) and take the history price for the flagged side at
the moment the bet was flagged, exactly as snapshot() would (last point at or before the target). We compare it
with the live ask at that moment:

    gap = p_hist(flag time) - live ask

If the history were honest, gap would not depend on the outcome. If history points carried information from after
their timestamp (an hourly bar stamped at its start but priced at its end, or a fallback 12-hour bar), winners would
show a higher gap than losers. Repeated for snapshot targets 1 h and 6 h before close, where a late price would
matter most, and with the backtest's own clock (ref = min(closedTime, endDate, gameStartTime)).

Also prices those same bets the backtest's way (p_hist + fee + max(0.5c, half median live spread)) to size the
mid-vs-ask question.

    python3 scripts/ledger/lookahead.py ledger.jsonl spreads.json cache_dir   (cache from replay_prices.py)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import first_flags, graded, load  # noqa: E402
from replay_prices import CLOB, FEE, GAMMA, cached, http, ts  # noqa: E402


def at(pts, target, tol=3 * 3600):
    best = None
    for p in pts:
        if p["t"] <= target:
            best = p
        else:
            break
    if not best or target - best["t"] > tol:
        return None
    return float(best["p"])


def mean(xs):
    return sum(xs) / len(xs) if xs else float("nan")


def main(ledger_p, spreads_p, cache):
    rows = first_flags(graded(load(ledger_p)))
    spreads = json.load(open(spreads_p))
    ids = sorted({e["id"] for e in rows})
    mk = {i: cached(cache, f"m{i}.json", lambda i=i: http("GET", f"{GAMMA}/markets/{i}")) for i in ids}
    toks = {i: json.loads(m.get("clobTokenIds") or "[]") for i, m in mk.items()}
    yes = [t[0] for t in toks.values() if len(t) == 2]
    hist = {}
    for k in range(0, len(yes), 20):
        chunk = yes[k:k + 20]
        d = cached(cache, f"h{k}.json", lambda chunk=chunk: http("POST", f"{CLOB}/batch-prices-history",
                                                                 dict(markets=chunk, interval="max", fidelity=60)))
        hist.update(d.get("history") or {})
    res = {"flag": ([], []), "close-6h": ([], []), "close-1h": ([], [])}
    priced = []
    for e in rows:
        t = toks.get(e["id"]) or []
        pts = sorted(hist.get(t[0]) or [], key=lambda x: x["t"]) if len(t) == 2 else []
        if not pts:
            continue
        side = (lambda p: p) if e["side_index"] == 0 else (lambda p: 1 - p)
        won = e["result"] == "won"
        m = mk[e["id"]]
        ref = min(r for r in (ts(m.get(k)) for k in ("closedTime", "endDate", "gameStartTime")) if r)
        p = at(pts, e["flagged_at"])
        if p is not None:
            res["flag"][0 if won else 1].append(side(p) - e["ask"])
            fee = FEE.get(e["category"], 0.05) * side(p) * (1 - side(p))
            mt = "moneyline" if e["category"] == "sports" else "yes/no"
            slip = max(0.005, ((spreads.get(f"{e['niche']}|{mt}") or {}).get("median") or 0) / 2)
            priced.append((e, side(p), side(p) + fee + slip))
        for name, h in (("close-6h", 6), ("close-1h", 1)):
            q = at(pts, ref - h * 3600)
            if q is not None:
                # how far the late history price sits toward the outcome, relative to the entry ask
                res[name][0 if won else 1].append(side(q) - e["ask"])
    print("history price minus live ask, by outcome (cents). Honest history: winners ~= losers at flag time.")
    for k, (w, l) in res.items():
        print(f"  {k:9s} won n={len(w):3d} mean {100 * mean(w):+6.2f}c | lost n={len(l):3d} mean {100 * mean(l):+6.2f}c "
              f"| difference {100 * (mean(w) - mean(l)):+6.2f}c")
    n = len(priced)
    w = sum(e["result"] == "won" for e, _, _ in priced)
    live_cost = sum(e["ask"] + e["fee"] for e, _, _ in priced)
    bt_cost = sum(c for _, _, c in priced)
    print(f"\nsame bets, flag-time prices (n={n}, won {w}):")
    print(f"  live: ask + fee      avg cost {100 * live_cost / n:5.2f}c  ROI {100 * (w - live_cost) / live_cost:+5.1f}%")
    print(f"  history price (mid)  avg      {100 * sum(p for _, p, _ in priced) / n:5.2f}c")
    print(f"  backtest pricing     avg cost {100 * bt_cost / n:5.2f}c  ROI {100 * (w - bt_cost) / bt_cost:+5.1f}%"
          "   (history price + fee + max(0.5c, half the median live spread))")
    for cat in sorted({e["category"] for e, _, _ in priced}):
        sel = [(e, p, c) for e, p, c in priced if e["category"] == cat]
        k = len(sel)
        ww = sum(e["result"] == "won" for e, _, _ in sel)
        lc = sum(e["ask"] + e["fee"] for e, _, _ in sel)
        bc = sum(c for _, _, c in sel)
        print(f"  {cat:8s} n={k:3d} ask-hist {100 * sum(e['ask'] - p for e, p, _ in sel) / k:+.2f}c  "
              f"ROI live {100 * (ww - lc) / lc:+5.1f}%  at backtest pricing {100 * (ww - bc) / bc:+5.1f}%")


if __name__ == "__main__":
    main(*sys.argv[1:])
