"""Weather break-out of the live ledger: by question type, entry price, side, city, horizon and close day.

    python3 scripts/ledger/weather.py ledger.jsonl [ledger_now.jsonl]
"""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from common import first_flags, graded, group_by, horizon, load, stats, fmt, table  # noqa: E402


def kind(q):
    q = q.lower()
    t = "high" if "highest" in q else "low" if "lowest" in q else "rain" if "rain" in q or "precip" in q else "other"
    r = "range" if "between" in q else "or above" if "or higher" in q or "or above" in q else \
        "or below" if "or below" in q or "or lower" in q else "exact"
    return f"{t} / {r}"


def city(q):
    m = re.search(r" in ([A-Z][\w .'-]+?)(?: be|,| on)", q)
    return m.group(1) if m else "?"


def band(p):
    return "90c+" if p >= 0.9 else "80-90c" if p >= 0.8 else "70-80c" if p >= 0.7 else "60-70c" if p >= 0.6 else "<60c"


def main(path, now_path=None):
    for name, p in (("published snapshot", path), ("plus rows settled since (grade_now)", now_path)):
        if not p:
            continue
        rows = [e for e in load(p) if e["category"] == "weather"]
        print(f"\n######## weather, {name}: {len(rows)} logged rows, {len(graded(rows))} settled rows, "
              f"{len(graded(first_flags(rows)))} settled first flags")
        print("  all rows    ", fmt(stats(rows)))
        print("  first flags ", fmt(stats(first_flags(rows))))
        ff = first_flags(rows)
        table("by question type (first flags)", group_by(ff, lambda e: kind(e["question"])))
        table("by entry price (first flags)", group_by(ff, lambda e: band(e["ask"])))
        table("by side bought (first flags)", group_by(ff, lambda e: e["outcome"]))
        table("by horizon (first flags)", group_by(ff, horizon))
        table("by close day UTC (first flags)", group_by(ff, lambda e: time.strftime("%m-%d", time.gmtime(e["closes_at"]))))
        cities = group_by(ff, lambda e: city(e["question"]))
        table("worst 6 cities (first flags)", sorted(cities, key=lambda kv: stats(kv[1]).get("cents", 0))[:6])


if __name__ == "__main__":
    main(*sys.argv[1:])
