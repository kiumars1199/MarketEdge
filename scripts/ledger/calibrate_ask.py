"""Calibrate the backtest's "taker_price": "ask" option from the real asks in the live ledger (T-296).

For every live best bet (first flag per side) we read the same CLOB hourly history the backtest prices from
(pipeline/fetch_prices: batch-prices-history, fidelity 60) and take the flagged side's history price at the moment
the bet was flagged, the way snapshot() does. The premium a live taker paid over that history price is

    premium = live ask - p_hist(flag time)

Its median per niche|market type (market type classified exactly as engine/dataset.market_type does, from the Gamma
market), per category ("cat:<c>"), and overall ("all") is written to ask_premium.json. Groups with fewer than
--min bets are left out, so the backtest falls back to the category, then to "all".

    python3 scripts/ledger/calibrate_ask.py ledger.jsonl cache_dir out.json [--min 20]
    (cache_dir from replay_prices.py / lookahead.py; copy out.json to output/ask_premium.json to use it)
"""
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import first_flags, graded, load  # noqa: E402
from lookahead import at  # noqa: E402
from replay_prices import CLOB, GAMMA, cached, http  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from engine.dataset import market_type  # noqa: E402


def premiums(ledger_p, cache):
    # the same rows as lookahead.py (graded first flags), so its cached history chunks are reused
    rows = first_flags(graded(load(ledger_p)))
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
    out = []
    for e in rows:
        t = toks.get(e["id"]) or []
        pts = sorted(hist.get(t[0]) or [], key=lambda x: x["t"]) if len(t) == 2 else []
        p = at(pts, e["flagged_at"]) if pts else None
        if p is None:
            continue
        side = p if e["side_index"] == 0 else 1 - p
        m = mk[e["id"]]
        mt = market_type(e["category"], m.get("sportsMarketType"), bool(m.get("negRisk")))
        out.append(dict(niche=e["niche"], cat=e["category"], mt=mt, prem=e["ask"] - side))
    return out


def calibrate(rows, min_n=20):
    groups = {}
    for r in rows:
        for k in (f"{r['niche']}|{r['mt']}", f"cat:{r['cat']}", "all"):
            groups.setdefault(k, []).append(r["prem"])
    return {k: dict(n=len(v), median=round(statistics.median(v), 4), mean=round(statistics.fmean(v), 4))
            for k, v in sorted(groups.items()) if len(v) >= min_n}


def main(argv):
    min_n = 20
    if "--min" in argv:
        i = argv.index("--min")
        min_n = int(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    ledger_p, cache, out = argv
    cal = calibrate(premiums(ledger_p, cache), min_n)
    json.dump(cal, open(out, "w"), indent=1)
    for k, v in cal.items():
        print(f"  {k:28s} n={v['n']:4d} median premium {100 * v['median']:+5.2f}c  mean {100 * v['mean']:+5.2f}c")


if __name__ == "__main__":
    main(sys.argv[1:])
