#!/usr/bin/env python3
"""RT-01: recover a Free-banded market's exact expected return and win chance through filter thresholds.
Usage: python3 -I filter_oracle.py http://localhost:3400 <market_id>
Anonymous (Free tier). Each probe is an ordinary /api/markets call; whether the market is in the 25 rows is the oracle:
the filter runs on the exact store values, the banding happens only afterwards (lib/data/respond.ts listRoute)."""
import json, sys, urllib.parse, urllib.request

base, mid = sys.argv[1], sys.argv[2]
calls = 0


def present(extra):
    global calls
    calls += 1
    qs = urllib.parse.urlencode({"g": "0", **extra})
    d = json.load(urllib.request.urlopen(f"{base}/api/markets?{qs}"))
    return any(r["market"]["id"] == mid for r in d["rows"])


# Isolate the target first: its exact ask is public in the Free row, so a +-0.0005 price window plus its category
# leaves a handful of rows. Then sort descending so the target stays inside the 25-row cap whenever it passes.
first = json.load(urllib.request.urlopen(f"{base}/api/markets/{mid}"))["market"]
iso = {"p0": repr(first["best"]["ask"] - 0.0005), "p1": repr(first["best"]["ask"] + 0.0005), "c": first["category"], "wp": "0"}


def search(key, lo, hi, sort, n=30):
    # Largest threshold x where "key >= x" still returns the market = the market's exact value.
    for _ in range(n):
        x = (lo + hi) / 2
        if present({**iso, key: repr(x), "s": sort}):
            lo = x
        else:
            hi = x
    return lo


roi = search("roi", -100.0, 1000.0, "roi.desc")
wp = search("wp", 0.0, 1.0, "win_prob.desc")
print(json.dumps({"market": mid, "exact_roi_pct": round(roi, 4), "exact_win_prob": round(wp, 6), "requests": calls}))
