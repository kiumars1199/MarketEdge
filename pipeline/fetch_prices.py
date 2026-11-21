"""Step 2: sample liquid markets and record the price N hours before resolution.

Reads data/markets.jsonl, writes data/sample.jsonl and data/snapshots.jsonl.
Snapshots only ever use a price observed AT OR BEFORE (resolution - N hours),
so no future information leaks in. Resumable: rerun to continue.
Usage: python pipeline/fetch_prices.py [--min-volume 0] [--per-niche 3000] [--threads 4]

After a backfill (fetch_closed.py --window-days), add the new markets to an existing sample
with --extend: each (niche, month) is topped up to --per-niche-month markets, so old months
get filled without re-sampling months the sample already covers. Also resumable.
"""
import argparse
import json
import os
import random
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
from common import CLOB, HORIZONS_H, http, jl_read, jl_write  # noqa: E402

D = os.path.join(os.path.dirname(__file__), "..", "data")
MARKETS, SAMPLE, SNAPS, DONE = (os.path.join(D, f) for f in
                                ("markets.jsonl", "sample.jsonl", "snapshots.jsonl", "done.txt"))
lock = threading.Lock()


def make_sample(min_vol, per_niche, seed=7):
    if os.path.exists(SAMPLE):
        return jl_read(SAMPLE)
    rows = [r for r in jl_read(MARKETS) if r["volume"] >= min_vol]
    by = {}
    for r in rows:
        by.setdefault(r["niche"], []).append(r)
    rnd = random.Random(seed)
    out = []
    for niche, rs in by.items():
        rnd.shuffle(rs)
        out += rs[:per_niche]
    with open(SAMPLE, "w") as f:
        for r in out:
            f.write(json.dumps(r) + "\n")
    return out


def extend_sample(per_niche_month, seed=7):
    """Append markets from markets.jsonl that are not in the sample yet, topping each
    (niche, month of resolution) up to `per_niche_month`. Streams markets.jsonl (can be GBs)."""
    import time as _t
    month = lambda r: _t.strftime("%Y-%m", _t.gmtime(r["ref_ts"]))
    have, count = set(), {}
    for r in jl_read(SAMPLE):
        have.add(r["id"])
        k = (r["niche"], month(r))
        count[k] = count.get(k, 0) + 1
    rnd = random.Random(seed)
    res, seen_n = {}, {}  # reservoir sample per (niche, month): memory stays bounded
    with open(MARKETS) as f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r["id"] in have:
                continue
            have.add(r["id"])
            k = (r["niche"], month(r))
            cap = per_niche_month - count.get(k, 0)
            if cap <= 0:
                continue
            n = seen_n[k] = seen_n.get(k, 0) + 1
            rs = res.setdefault(k, [])
            if len(rs) < cap:
                rs.append(r)
            elif (j := rnd.randrange(n)) < cap:
                rs[j] = r
    add = [r for k in sorted(res) for r in res[k]]
    jl_write(SAMPLE, add)
    print(f"sample extended by {len(add)} markets", flush=True)
    return jl_read(SAMPLE)


def history(tokens, fidelity, start_ts=None, end_ts=None):
    """Price history per token. Without a window the CLOB uses interval=max, which returns
    nothing at 1 h fidelity for older markets; a start/end window (at most ~15 days) does."""
    body = dict(markets=tokens, fidelity=fidelity)
    if start_ts is None:
        body["interval"] = "max"
    else:
        body.update(start_ts=int(start_ts), end_ts=int(end_ts))
    d = http("POST", f"{CLOB}/batch-prices-history", json=body)
    return d.get("history") or {}


WINDOW_S = 14 * 86400          # CLOB rejects longer start/end windows
LOOKBACK_S = 8 * 86400         # longest horizon (7 d) plus its tolerance


def windowed(missing):
    """Hourly history for markets interval=max missed, in groups whose window fits the CLOB limit."""
    out, group = {}, []
    for m in sorted(missing, key=lambda m: m["ref_ts"]) + [None]:
        if group and (m is None or m["ref_ts"] - group[0]["ref_ts"] + LOOKBACK_S > WINDOW_S):
            out.update(history([g["tokens"][0] for g in group], 60,
                               group[0]["ref_ts"] - LOOKBACK_S, group[-1]["ref_ts"]))
            group = []
        if m is not None:
            group.append(m)
    return out


def snapshot(pts, m):
    out = []
    pts = sorted(pts, key=lambda x: x["t"])
    for h in HORIZONS_H:
        target = m["ref_ts"] - h * 3600
        tol = max(1800, min(0.5 * h * 3600, 13 * 3600))
        best = None
        for p in pts:
            if p["t"] <= target:
                best = p
            else:
                break
        if not best or target - best["t"] > tol or best["t"] < m["start_ts"]:
            continue
        # require the market to have actually traded before the snapshot
        if len({p["p"] for p in pts if p["t"] <= target}) < 3:
            continue
        price = float(best["p"])
        if 0 < price < 1:
            out.append(dict(id=m["id"], h=h, p=price, lag=int(target - best["t"])))
    return out


def work(batch):
    toks = [m["tokens"][0] for m in batch]
    hist = history(toks, 60)
    missing = [m for m in batch if not hist.get(m["tokens"][0])]
    if missing:
        hist.update(windowed(missing))
    missing = [m for m in batch if not hist.get(m["tokens"][0])]
    if missing:
        hist.update(history([m["tokens"][0] for m in missing], 720))
    snaps = []
    for m in batch:
        snaps += snapshot(hist.get(m["tokens"][0]) or [], m)
    with lock:
        jl_write(SNAPS, snaps)
        with open(DONE, "a") as f:
            f.write("\n".join(m["id"] for m in batch) + "\n")
    return len(snaps)


def fetch_pending(sample, threads=4, log=print):
    """Fetch snapshots for every market in `sample` not yet in done.txt (newest first)."""
    done = set()
    if os.path.exists(DONE):
        done = set(open(DONE).read().split())
    # newest first: recent markets matter most, and a partial run still has them
    todo = sorted((m for m in sample if m["id"] not in done), key=lambda m: -m["ref_ts"])
    log(f"sample={len(sample)} remaining={len(todo)}")
    batches = [todo[i:i + 20] for i in range(0, len(todo), 20)]
    n = 0
    with ThreadPoolExecutor(threads) as ex:
        futs = [ex.submit(work, b) for b in batches]
        for i, f in enumerate(as_completed(futs)):
            try:
                n += f.result()
            except Exception as e:  # keep going; failed batches retry on rerun
                log(f"batch error: {e}")
            if i % 100 == 0:
                log(f"batches {i}/{len(batches)} snapshots+={n}")
    log(f"done, snapshots added: {n}")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-volume", type=float, default=0)  # keep 0: final volume leaks the outcome
    ap.add_argument("--per-niche", type=int, default=3000)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--extend", action="store_true", help="add new markets.jsonl rows to the sample")
    ap.add_argument("--per-niche-month", type=int, default=1500)
    a = ap.parse_args()
    sample = extend_sample(a.per_niche_month) if a.extend else make_sample(a.min_volume, a.per_niche)
    fetch_pending(sample, a.threads,
                  log=lambda s: print(s, flush=True))


if __name__ == "__main__":
    main()
