"""Live ledger breakdown: reconcile the counts with ledger_summary.json, then split the settled best bets by
everything the brief asks about (entry price, verdict, price band, category, niche, horizon, predicted edge, day).

    git fetch origin live --depth=1
    git show origin/live:ledger.jsonl > /tmp/ledger.jsonl
    git show origin/live:ledger_summary.json > /tmp/ledger_summary.json
    python3 scripts/ledger/analyze.py /tmp/ledger.jsonl [/tmp/ledger_summary.json] [/tmp/flags.json]
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from common import first_flags, graded, group_by, horizon, load, stats, table, fmt, hours_before_close  # noqa: E402


def band(p):
    for lo in (0.95, 0.90, 0.85, 0.80, 0.70, 0.60, 0.50):
        if p >= lo:
            return f"{int(lo * 100)}c+"
    return "<50c"


def edge_band(x):
    for lo in (0.15, 0.10, 0.05, 0.02):
        if x >= lo:
            return f"{int(lo * 100):2d}c+"
    return "<2c"


def day(t):
    return time.strftime("%m-%d", time.gmtime(t))


def main(path, summary_path=None, flags_path=None):
    rows = load(path)
    g = graded(rows)
    firsts = first_flags(rows)
    print("== reconcile ==")
    print(f"rows {len(rows)}, graded rows {len(g)}, unique market sides {len(firsts)}, "
          f"graded unique sides {len(graded(firsts))}, re-flag rows {len(rows) - len(firsts)} "
          f"(graded re-flags {len(g) - len(graded(firsts))})")
    s = stats(rows)
    pnl_sum = sum(e["pnl"] for e in g)
    print(f"avg_pnl {pnl_sum / len(g):+.4f} per share; ROI = sum(pnl)/sum(ask+fee) = {s['roi']:+.2f}%; "
          f"liveReturn (lib/proof: pnl/(wins-pnl)) = {100 * pnl_sum / (s['wins'] - pnl_sum):+.2f}%")
    if summary_path:
        sm = json.load(open(summary_path))
        print("ledger_summary.json:", {k: sm[k] for k in ("entries", "graded", "wins", "losses", "avg_pnl", "avg_clv")})
        for c, v in sm["by_category"].items():
            mine = stats([e for e in rows if e["category"] == c])
            print(f"  {c:10s} summary graded={v['graded']} avg_pnl={v['avg_pnl']}  recomputed n={mine.get('n')} "
                  f"pnl={mine.get('cents', 0) / 100:+.4f} roi={mine.get('roi', 0):+.2f}%")
    span = [e["flagged_at"] for e in rows]
    print(f"flagged {time.strftime('%Y-%m-%d %H:%M', time.gmtime(min(span)))} .. "
          f"{time.strftime('%Y-%m-%d %H:%M', time.gmtime(max(span)))} UTC; "
          f"graded_at {sorted({e['graded_at'] for e in g})}")

    print("\n== all settled rows (as the site counts them) ==")
    print("  ", fmt(s))
    print("== first flag per market side only ==")
    print("  ", fmt(stats(firsts)))

    for name, rs in (("all rows", rows), ("first flags", firsts)):
        print(f"\n######## {name}")
        table("by category", group_by(rs, lambda e: e["category"]))
        table("by verdict at flag time (order book check)", group_by(rs, lambda e: e["verdict"]))
        table("by entry price (ask)", group_by(rs, lambda e: band(e["ask"])))
        table("by predicted edge after fee", group_by(rs, lambda e: edge_band(e["edge"])))
        table("by horizon (h before close when flagged)", group_by(rs, horizon))
        table("by category x price >= 90c", group_by(rs, lambda e: (e["category"], e["ask"] >= 0.90)))
        table("by niche", group_by(rs, lambda e: e["niche"]))
        table("by flag day (UTC)", group_by(rs, lambda e: day(e["flagged_at"])))

    # 90c+ favourites: small wins, big losses
    fav = [e for e in g if e["ask"] >= 0.90]
    if fav:
        w = [e["pnl"] for e in fav if e["result"] == "won"]
        lo = [e["pnl"] for e in fav if e["result"] == "lost"]
        print(f"\n90c+ entries: {len(fav)} settled of {len(g)} ({100 * len(fav) / len(g):.0f}%), "
              f"avg win +{100 * sum(w) / max(1, len(w)):.1f}c, avg loss {100 * sum(lo) / max(1, len(lo)):.1f}c, "
              f"total pnl {sum(e['pnl'] for e in fav):+.2f} of {sum(e['pnl'] for e in g):+.2f}")
    # largest single losses
    print("\nbiggest pnl contributors (sum by question prefix):")
    agg = {}
    for e in g:
        k = e["question"].split(":")[0][:50]
        agg[k] = agg.get(k, 0) + e["pnl"]
    for k, v in sorted(agg.items(), key=lambda kv: kv[1])[:8]:
        print(f"   {v:+.2f}  {k}")
    print("   ...")
    for k, v in sorted(agg.items(), key=lambda kv: kv[1])[-5:]:
        print(f"   {v:+.2f}  {k}")
    # hours before close distribution
    hs = sorted(hours_before_close(e) for e in g)
    print(f"\nhours before close (settled): median {hs[len(hs) // 2]:.1f}, p10 {hs[len(hs) // 10]:.1f}, p90 {hs[9 * len(hs) // 10]:.1f}")

    if flags_path:
        # entry check: the ledger logs Gamma's bestAsk; the scan also read the CLOB book (execution.best_ask)
        fl = json.load(open(flags_path))["flags"]
        tiers = {}
        for r in fl:
            tiers[r["id"]] = r.get("tier")
        ids = {e["id"] for e in rows}
        print(f"\nflags.json (latest scan): {len(fl)} flags; tiers {dict((t, sum(1 for r in fl if r.get('tier') == t)) for t in ('best', 'edge'))}; "
              f"ledger ids that are tier 'edge' now: {sum(1 for i in ids if tiers.get(i) == 'edge')}")
        diffs = []
        for r in fl:
            x = r.get("execution") or {}
            if r.get("tier") == "best" and x.get("best_ask") is not None:
                diffs.append(x["best_ask"] - r["best"]["ask"])
        if diffs:
            diffs.sort()
            print(f"best tier, book best_ask - logged ask: n={len(diffs)} mean {100 * sum(diffs) / len(diffs):+.2f}c, "
                  f"median {100 * diffs[len(diffs) // 2]:+.2f}c, share >0: {100 * sum(d > 0.0001 for d in diffs) / len(diffs):.0f}%")


if __name__ == "__main__":
    main(*sys.argv[1:])
