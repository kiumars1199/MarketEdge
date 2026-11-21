"""Two checks behind docs/research/live-vs-backtest.md §3 and §4.

1. Is the held-out split independent of the in-sample one? Held-out = rows settled in ledger_now.jsonl that were not
   settled in the published snapshot (grade_now.py). Prints their flag days and how many of their events also appear
   in-sample (event = scripts/ledger/common.event_key).
2. What does engine/ledger.summarize (US venue) report on these rows? `first.events` vs `first.graded` shows that
   rows logged without `event_id` each count as their own event; `us` is empty for rows logged before US prices.

    python3 scripts/ledger/split_check.py ledger.jsonl ledger_now.jsonl      (run from the repo root)
"""
import os
import sys
import time
from collections import Counter

import importlib.util  # noqa: E402

# pipeline/ also has a common.py on sys.path once engine.ledger is imported, so load ours under its own name
_spec = importlib.util.spec_from_file_location("ledger_common", os.path.join(os.path.dirname(__file__), "common.py"))
_c = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_c)
event_key, graded, load = _c.event_key, _c.graded, _c.load
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from engine.ledger import summarize  # noqa: E402


def main(pub_p, now_p):
    key = lambda e: (e["id"], e["side_index"], e["flagged_at"])  # noqa: E731
    pub = {key(e) for e in graded(load(pub_p))}
    now_rows = load(now_p)
    now = graded(now_rows)
    held = [e for e in now if key(e) not in pub]
    ins = [e for e in now if key(e) in pub]
    ie, he = {event_key(e) for e in ins}, {event_key(e) for e in held}
    print(f"in-sample rows {len(ins)} events {len(ie)} | held-out rows {len(held)} events {len(he)}")
    print(f"held-out events also in-sample: {len(he & ie)}; held-out rows in them: {sum(event_key(e) in ie for e in held)}")
    print("held-out by flag day:", dict(Counter(time.strftime('%m-%d', time.gmtime(e['flagged_at'])) for e in held)))
    print("held-out by category:", dict(Counter(e["category"] for e in held)))
    s = summarize(now_rows, 0)
    for k in ("first", "us", "intl_only"):
        print(f"summarize {k:9s}", {x: s[k].get(x) for x in ("entries", "graded", "events", "roi_pct")})
    print(f"events by event_key among settled rows: {len({event_key(e) for e in now})}; "
          f"logged rows with event_id: {sum(1 for e in now_rows if e.get('event_id'))} of {len(now_rows)}")


if __name__ == "__main__":
    main(*sys.argv[1:])
