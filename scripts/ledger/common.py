"""Shared helpers for the ledger scripts (docs/research/live-vs-backtest.md). Standard library only.

A ledger row is one $1-payout share bought at `ask` plus `fee` (engine/ledger.py):
    pnl  = (won ? 1 : 0) - ask - fee
    cost = ask + fee
Return (ROI) = sum(pnl) / sum(cost), the same definition as the backtest's roi_pct and lib/proof liveReturn.
"""
import json
import math
import re
from collections import defaultdict


def load(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def graded(rows):
    return [e for e in rows if "result" in e]


def first_flags(rows):
    """One row per market side: the first time it was flagged. engine/ledger.append also logs a re-flag whenever
    the same side is flagged again at a lower ask, so the raw ledger counts some bets two or more times."""
    seen, out = set(), []
    for e in sorted(rows, key=lambda e: e["flagged_at"]):
        k = (e["id"], e["side_index"])
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out


def hours_before_close(e):
    return (e["closes_at"] - e["flagged_at"]) / 3600


def horizon(e):
    """The engine's horizon bucket (scan.nearest_h) for the time left when flagged."""
    h = hours_before_close(e)
    if h < 0.5 or h > 240:
        return None
    return min((1, 6, 24, 72, 168), key=lambda x: abs(math.log(h) - math.log(x)))


def event_key(e):
    """Best-effort event id for clustering (the ledger has no event id). Sports: the game (question before ':').
    Weather: city + high/low/rain + day, so every temperature bucket of one city-day is one event, as on Polymarket."""
    q = e["question"]
    day = e["closes_at"] // 86400
    if e["category"] == "weather":
        m = re.search(r"(highest|lowest|rain|precipitation)\D*? in ([A-Z][\w .'-]+?)(?: be|,| on|\?)", q)
        if m:
            return ("weather", m.group(1), m.group(2), day)
    return (q.split(":")[0].strip(), day, e["category"])


def stats(rows):
    g = graded(rows)
    n = len(g)
    if not n:
        return dict(n=0)
    pnl = [e["pnl"] for e in g]
    cost = sum(e["ask"] + e["fee"] for e in g)
    wins = sum(e["result"] == "won" for e in g)
    clv = [e["clv"] for e in g if e.get("clv") is not None]
    ev = defaultdict(float)
    m = sum(pnl) / n
    for e in g:
        ev[event_key(e)] += e["pnl"] - m
    se = math.sqrt(sum(v * v for v in ev.values())) / n
    return dict(
        n=n, events=len(ev), wins=wins, win_rate=wins / n,
        avg_ask=sum(e["ask"] for e in g) / n,
        pred_win=sum(e["win_prob"] for e in g) / n,
        pred_edge=sum(e["edge"] for e in g) / n,
        cents=100 * m, roi=100 * sum(pnl) / cost,
        t=(m / se) if se > 0 else 0.0,
        clv=(100 * sum(clv) / len(clv)) if clv else None,
    )


def fmt(s):
    if not s.get("n"):
        return "n=0"
    clv = f"{s['clv']:+.1f}c" if s["clv"] is not None else "—"
    return (f"n={s['n']:4d} ev={s['events']:4d} won={100 * s['win_rate']:5.1f}% (model {100 * s['pred_win']:5.1f}%) "
            f"ask={100 * s['avg_ask']:4.1f}c pnl={s['cents']:+6.2f}c/share roi={s['roi']:+6.1f}% t={s['t']:+5.2f} clv={clv}")


def table(title, groups):
    print(f"\n{title}")
    for k, rows in groups:
        print(f"  {str(k):28s} {fmt(stats(rows))}")


def group_by(rows, key):
    d = defaultdict(list)
    for e in rows:
        d[key(e)].append(e)
    return sorted(d.items(), key=lambda kv: (-len(graded(kv[1])), str(kv[0])))
