"""Live record with and without the Best-bets cap per game (docs/OVERHAUL.md §G5), applied retroactively.

    git fetch origin live --depth=1
    git show origin/live:ledger.jsonl > /tmp/ledger.jsonl
    python3 scripts/ledger/cap_check.py /tmp/ledger.jsonl [--k 2] [--json out.json]

Live rows logged before Nov 20 carry no event_id, so the script looks each market's event up on Gamma
(GET /markets?id=..., batched; closed markets need closed=true) and caches the map next to the ledger
(<ledger>.events.json). Stats come from engine.ledger.summarize()["first"]: each market and side once, graded
rows only, avg_pnl per bet and avg_pnl_by_event (each game's bets averaged, then games averaged equally).

Cap rules compared (k lines per event):
  best     the brief's definition: per event, the k best lines by the scan's ranking (verdict "worth it" before
           "thin" before the rest, then higher edge), using flag-time values, over every bet the event ever had
  first    what the ledger-aware live cap does going forward: per event, the first k lines logged
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from engine.ledger import first_rows, summarize  # noqa: E402
from engine.scan import VERDICT_RANK  # noqa: E402
from pipeline.common import GAMMA, http, jl_read  # noqa: E402


def event_map(ids, cache_path, get=http, log=print):
    """market id -> Gamma event id, cached."""
    try:
        m = json.load(open(cache_path))
    except (FileNotFoundError, ValueError):
        m = {}
    todo = sorted(set(ids) - set(m))
    for closed in (None, "true"):
        for i in range(0, len(todo), 50):
            chunk = [x for x in todo[i:i + 50] if x not in m]
            if not chunk:
                continue
            params = [("id", x) for x in chunk] + [("limit", 50)] + ([("closed", closed)] if closed else [])
            for mk in get("GET", f"{GAMMA}/markets", params=params) or []:
                evs = mk.get("events") or []
                if evs:
                    m[str(mk["id"])] = str(evs[0]["id"])
        todo = [x for x in todo if x not in m]
    if todo:
        log(f"no event found for {len(todo)} markets; each counts as its own event")
    json.dump(m, open(cache_path, "w"))
    return m


def rank(e):
    return VERDICT_RANK.get(e.get("verdict"), 2), -(e.get("edge") or 0)


def capped(entries, k, rule):
    """Entries (every row, re-flags included) of the bets the cap keeps."""
    by_ev = {}
    for e in first_rows(entries):  # flag-time values: each bet's first logged row
        by_ev.setdefault(e.get("event_id") or e["id"], []).append(e)
    keep = set()
    for rows in by_ev.values():
        pick = sorted(rows, key=rank)[:k] if rule == "best" else sorted(rows, key=lambda e: e["flagged_at"])[:k]
        keep.update((e["id"], e["side_index"]) for e in pick)
    return [e for e in entries if (e["id"], e["side_index"]) in keep]


def stats(entries):
    f = summarize(entries, 0)["first"]
    return dict(settled=f["graded"], wins=f["wins"], events=f["events"], avg_pnl=f["avg_pnl"],
                avg_pnl_by_event=f["avg_pnl_by_event"], roi_pct=f["roi_pct"])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("ledger")
    ap.add_argument("--k", type=int, default=2)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    entries = jl_read(a.ledger)
    missing = [e["id"] for e in entries if not e.get("event_id")]
    if missing:
        ev = event_map(missing, a.ledger + ".events.json")
        for e in entries:
            if not e.get("event_id") and e["id"] in ev:
                e["event_id"] = ev[e["id"]]
    out = {}
    cats = sorted({e["category"] for e in entries})
    for name, es in [("no cap", entries), (f"cap {a.k} best", capped(entries, a.k, "best")),
                     (f"cap {a.k} first", capped(entries, a.k, "first")), ("cap 1 best", capped(entries, 1, "best")),
                     ("cap 3 best", capped(entries, 3, "best"))]:
        out[name] = dict(all=stats(es), **{c: stats([e for e in es if e["category"] == c]) for c in cats})
    print(f"{'rule':<14}{'scope':<10}{'settled':>8}{'events':>8}{'wins':>6}{'per bet':>10}{'per event':>11}{'roi %':>8}")
    for name, by in out.items():
        for scope, s in by.items():
            print(f"{name:<14}{scope:<10}{s['settled']:>8}{s['events']:>8}{s['wins']:>6}"
                  f"{s['avg_pnl'] if s['avg_pnl'] is not None else '-':>10}"
                  f"{s['avg_pnl_by_event'] if s['avg_pnl_by_event'] is not None else '-':>11}"
                  f"{s['roi_pct'] if s['roi_pct'] is not None else '-':>8}")
    if a.json:
        json.dump(out, open(a.json, "w"), indent=1)
    return out


if __name__ == "__main__":
    main()
