"""Candidate best-bet filters, scored on the live ledger with an in-sample / held-out split.

In-sample  = rows the published `live` snapshot had already graded (all flagged Nov 17, settled by Nov 19 19:41).
Held-out   = rows graded later by scripts/ledger/grade_now.py (graded_by == "grade_now"): settled after the snapshot,
             so nothing about them was looked at while choosing the filter.
Each filter is a fixed rule chosen from the brief's hypotheses (edge cap, correlated bets on one event, price band),
plus a threshold sweep for the edge cap run on in-sample rows only. Reported on raw rows (as the site counts them)
and on first flags per market side (no re-flag double counting).

    python3 scripts/ledger/filters.py ledger_now.jsonl
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from common import event_key, first_flags, fmt, graded, load, stats  # noqa: E402


def one_per_event(rows):
    """engine scan `best_one_per_event`: per event and scan, keep only the flag with the largest edge."""
    best = {}
    for e in rows:
        k = (event_key(e), e["flagged_at"])
        if k not in best or e["edge"] > best[k]["edge"]:
            best[k] = e
    keep = {id(e) for e in best.values()}
    return [e for e in rows if id(e) in keep]


def cap(x):
    return lambda rows: [e for e in rows if e["edge"] < x]


FILTERS = {
    "none (as live)": lambda rows: rows,
    "edge < 10c": cap(0.10),
    "one per event": one_per_event,
    "one per event + edge < 10c": lambda rows: one_per_event(cap(0.10)(rows)),
    "ask >= 60c": lambda rows: [e for e in rows if e["ask"] >= 0.60],
    "weather only": lambda rows: [e for e in rows if e["category"] == "weather"],
}


def main(path):
    rows = load(path)
    ins = [e for e in rows if "result" in e and e.get("graded_by") != "grade_now"]
    held = [e for e in rows if e.get("graded_by") == "grade_now"]
    print(f"in-sample settled rows {len(ins)}, held-out settled rows {len(held)}")
    for label, fn in (("raw rows", lambda r: r), ("first flag per side", first_flags)):
        print(f"\n== {label} ==")
        for name, f in FILTERS.items():
            # filters run on everything that was logged (the engine sees open and settled rows alike), then score
            a = stats(f(fn(ins)))
            b = stats(f(fn(held)))
            c = stats(f(fn(ins + held)))
            print(f"  {name:28s}\n     in-sample {fmt(a)}\n     held-out  {fmt(b)}\n     both      {fmt(c)}")
    print("\n== edge cap sweep, in-sample only (first flag per side) ==")
    for x in (0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 1.0):
        print(f"  edge < {int(x * 100):3d}c  {fmt(stats(cap(x)(first_flags(ins))))}")
    print("\n== same sweep, held-out ==")
    for x in (0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 1.0):
        print(f"  edge < {int(x * 100):3d}c  {fmt(stats(cap(x)(first_flags(held))))}")
    # held-out by category
    print("\n== held-out by category (first flags) ==")
    d = defaultdict(list)
    for e in first_flags(held):
        d[e["category"]].append(e)
    for c, rs in d.items():
        print(f"  {c:10s} {fmt(stats(rs))}")
    print(f"\nheld-out flag days: {sorted({__import__('time').strftime('%m-%d', __import__('time').gmtime(e['flagged_at'])) for e in graded(held)})}")


if __name__ == "__main__":
    main(sys.argv[1])
