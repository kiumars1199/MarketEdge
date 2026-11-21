"""Print the chosen walk-forward result from a backtest.json: totals, categories, horizons, edge buckets,
payout bands and every weekly fold (the "May week" check).

    python3 scripts/ledger/backtest_summary.py path/to/backtest.json
"""
import json
import sys
import time


def day(t):
    return time.strftime("%Y-%m-%d", time.gmtime(t))


def main(path):
    b = json.load(open(path))
    print({k: v for k, v in b.items() if k not in ("results", "combos", "data")})
    print("data:", b.get("data"))
    hl = str(b["chosen_half_life_days"])
    r = b["results"][hl]
    for k in ("taker", "maker", "taker_tight_spread", "baseline_all_bets_taker"):
        print(f"{k:26s}", r[k])
    print("by category:")
    for c, v in r["by_category"].items():
        print(f"  {c:14s}", v)
    print("by category, tight spread:")
    for c, v in r.get("by_category_tight_spread", {}).items():
        print(f"  {c:14s}", v)
    print("by horizon:")
    for c, v in r["by_horizon"].items():
        print(f"  {c:>4s}h", v)
    print("edge buckets:")
    for x in r["edge_buckets"]:
        print("  ", x)
    for tier in ("best", "edge"):
        print(f"by pays ({tier}):")
        for k, v in r["by_pays"][tier].items():
            print(f"  {k:7s}", v)
    print("folds (week start, bets, roi%, c/share, events, avg price, win rate):")
    for f in r["folds"]:
        print(f"  {day(f['start'])} {f.get('flags', 0):5d} {f.get('roi_pct')!s:>7} {f.get('pnl_cents_per_share')!s:>7}"
              f" {f.get('events')!s:>5} {f.get('avg_price')!s:>7} {f.get('win_rate')!s:>7}")
    # concentration: how much of the "1 year" test is its last two weeks? cost per fold = pnl / roi.
    def agg(fs):
        fs = [f for f in fs if f.get("flags") and f.get("roi_pct")]
        n = sum(f["flags"] for f in fs)
        pnl = sum(f["flags"] * f["pnl_cents_per_share"] / 100 for f in fs)
        cost = sum(f["flags"] * f["pnl_cents_per_share"] / 100 / (f["roi_pct"] / 100) for f in fs)
        return n, (100 * pnl / cost if cost else None), sum(1 for f in fs if f["roi_pct"] > 0), len(fs)
    folds = r["folds"]
    tot = sum(f.get("flags", 0) for f in folds)
    for name, fs in (("last 2 weeks", folds[-2:]), ("all earlier weeks", folds[:-2]), ("all weeks", folds)):
        n, roi, up, k = agg(fs)
        print(f"{name:18s} bets {n:6d} ({100 * n / tot:4.1f}% of {tot})  ROI {roi:+.1f}%  weeks up {up}/{k} with bets")
    print("taker by half-life:")
    for k, v in b["results"].items():
        print(f"  {k:5s}", v["taker"])


if __name__ == "__main__":
    main(sys.argv[1])
