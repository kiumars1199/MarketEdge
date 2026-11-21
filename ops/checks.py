"""Data checks from docs/12 (run before publishing scan output anywhere).

    python ops/checks.py [output_dir] [--prev-scanned-at UNIX]

Exit 0 = safe to publish, 1 = keep the previous data.
"""
import argparse
import json
import math
import os
import sys


def _nan_paths(x, path="$"):
    if isinstance(x, float) and not math.isfinite(x):
        yield path
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from _nan_paths(v, f"{path}.{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from _nan_paths(v, f"{path}[{i}]")


MAX_BEST_SHARE = 0.10


def check(markets, flags, prev_scanned_at=None):
    """Return a list of problems; empty means the data may be published."""
    errs = []
    meta = markets.get("meta", {})
    scanned = meta.get("markets_scanned", 0)
    min_edge = meta.get("rule", {}).get("min_edge", 0.02)
    rows = flags.get("flags", [])
    if scanned < 1000:
        errs.append(f"too few markets scanned: {scanned} < 1000")
    # Sanity cap against a broken model flagging everything: applies to tier "best" only (docs/18 §2).
    # 10%, not docs/12's 5%: the 2-year history validates more categories (7.7% on Nov 17, backtest t=34.7).
    best = [r for r in rows if r.get("tier", "best") == "best"]
    if len(best) > MAX_BEST_SHARE * max(1, scanned):
        errs.append(f"too many best bets: {len(best)} > {MAX_BEST_SHARE:.0%} of {scanned}")
    for r in rows:
        b = r.get("best") or {}
        rid = r.get("id", "?")
        if r.get("tier", "best") == "edge":   # docs/18 §2: edge >= min, model neff >= 40, live book
            if not b.get("edge", -1) >= min_edge - 1e-9:
                errs.append(f"flag {rid}: edge {b.get('edge')} < min_edge {min_edge}")
            if not (r.get("execution") or {}).get("book_ok"):
                errs.append(f"flag {rid}: tier edge without a live book")
            if not b.get("model_neff", 0) >= 40:
                errs.append(f"flag {rid}: tier edge with model_neff < 40")
            continue
        if not b.get("edge", -1) >= min_edge - 1e-9:
            errs.append(f"flag {rid}: edge {b.get('edge')} < min_edge {min_edge}")
        if not b.get("edge_low", 0) > 0:
            errs.append(f"flag {rid}: edge_low {b.get('edge_low')} not > 0")
        if not r.get("validated"):
            errs.append(f"flag {rid}: not validated")
        if "execution" not in r:
            errs.append(f"flag {rid}: no execution check")
    for name, doc in (("markets.json", markets), ("flags.json", flags)):
        bad = list(_nan_paths(doc))
        if bad:
            errs.append(f"{name}: {len(bad)} NaN/inf values, first at {bad[0]}")
    s_at = meta.get("scanned_at")
    if flags.get("meta", {}).get("scanned_at") != s_at:
        errs.append("markets.json and flags.json come from different scans")
    if prev_scanned_at is not None and not (s_at or 0) > prev_scanned_at:
        errs.append(f"scanned_at {s_at} is not newer than the published {prev_scanned_at}")
    return errs[:50]


def check_dir(out_dir, prev_scanned_at=None):
    with open(os.path.join(out_dir, "markets.json")) as f:
        markets = json.load(f)
    with open(os.path.join(out_dir, "flags.json")) as f:
        flags = json.load(f)
    return check(markets, flags, prev_scanned_at)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="ops/checks.py")
    ap.add_argument("out_dir", nargs="?", default="output")
    ap.add_argument("--prev-scanned-at", type=int)
    a = ap.parse_args(argv)
    errs = check_dir(a.out_dir, a.prev_scanned_at)
    for e in errs:
        print("data check failed:", e, file=sys.stderr)
    if not errs:
        print("data checks ok")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
