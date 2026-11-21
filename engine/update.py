"""Incremental update: pull markets that resolved since the last run, plus their prices.

Every newly resolved market is kept (no sampling cap), because recent markets
carry the most weight in the model. Safe to run as often as you like: markets
already stored are skipped, and the lookback window re-checks the last few days
for markets that settled late.
"""
import json
import os
import sys
import time

from pipeline.common import SAMPLE_TAGS, jl_write

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import fetch_closed  # noqa: E402
import fetch_prices  # noqa: E402


def _ids(path):
    ids = set()
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                i = line.find('"id": "')
                if i >= 0:
                    ids.add(line[i + 7:line.index('"', i + 7)])
    return ids


def run(cfg, log=print):
    state_p = cfg.path("data", "state.json")
    state = json.load(open(state_p)) if os.path.exists(state_p) else {}
    sample_p = cfg.path("data", "sample.jsonl")
    seen = _ids(sample_p)
    # First update after a bootstrap: the bootstrap already pulled every closed market, so only look back a few
    # days from when the sample was written (a 30-day window held GBs of events in memory and got the job killed).
    if state.get("last_update_ts"):
        last = state["last_update_ts"]
    elif os.path.exists(sample_p):
        last = os.path.getmtime(sample_p) - 3 * 86400
    else:
        last = time.time() - 30 * 86400
    lo, now = last - cfg.update_lookback_days * 86400, time.time()
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(lo))
    new = []
    for tag in SAMPLE_TAGS:
        # bounded offsets: busy windows are split (fetch_closed.closed_events), never paged past Gamma's limit
        for e in fetch_closed.closed_events(tag, lo, now):
            new += fetch_closed.market_rows(e, seen)
    log(f"new resolved markets since {since}: {len(new)}")
    if new:
        jl_write(sample_p, new)
    # prices for every stored market still missing them (new ones, plus any earlier failures)
    from pipeline.common import jl_read
    added = fetch_prices.fetch_pending(jl_read(sample_p), threads=8, log=log)
    state.update(last_update_ts=time.time(), last_new_markets=len(new), last_new_snapshots=added)
    json.dump(state, open(state_p, "w"))
    return len(new)
