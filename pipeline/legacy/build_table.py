"""Step 3: build the win-rate table and run the go/no-go backtest.

Each snapshot becomes two "bets": buy side A at price p, or side B at 1 - p.
Bets are grouped by (scope, horizon, 5c price band). For each group:
  win_rate  = share of bets that won
  edge      = win_rate - avg price - fee - slippage   (per $1 payout share)
Groups are learned on the OLDEST 70% of markets (by resolution time) and
checked on the NEWEST 30%. Standard errors are clustered by event, because
markets in the same event (e.g. props for one game) move together.

Outputs: output/edges.json (for the UI/scanner), output/backtest.md (summary).
"""
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from common import jl_read, taker_fee  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
D, O = os.path.join(ROOT, "data"), os.path.join(ROOT, "output")
SLIPPAGE = 0.005   # assume we pay ~0.5c over the quoted price when taking
BAND = 0.05
P_MIN, P_MAX = 0.05, 0.95
MIN_N = 150        # min bets in a group to publish it
MIN_EVENTS = 30    # min distinct events in a group
# Markets that resolved in the last week behave oddly in the data (favorites win far
# more than in every earlier period), likely because not every market from those
# events has settled yet. Leave them out until they age.
EXCLUDE_RECENT_DAYS = 7


def mtype(m):
    t = m.get("market_type")
    if m["category"] == "sports":
        if t in (None, "moneyline"):
            return "moneyline"
        if "spread" in t:
            return "spreads"
        if "total" in t:
            return "totals"
        return "props"
    return "multi-outcome" if m.get("neg_risk") else "yes/no"


def band(p):
    i = min(int(p / BAND), int(1 / BAND) - 1)
    return round(i * BAND, 2)


def bets(markets, snaps):
    out = []
    for s in snaps:
        m = markets.get(s["id"])
        if not m:
            continue
        for side, p, won in ((0, s["p"], m["yes_won"]), (1, 1 - s["p"], 1 - m["yes_won"])):
            if not (P_MIN <= p < P_MAX):
                continue
            out.append(dict(id=m["id"], ev=m["event_id"], side=side, p=p, won=won, h=s["h"],
                            cat=m["category"], niche=m["niche"], mt=mtype(m), ts=m["ref_ts"],
                            fee=taker_fee(m["category"], p)))
    return out


def scopes(b):
    yield ("all", "all", "all")
    yield ("category", b["cat"], "all")
    yield ("niche", b["niche"], "all")
    yield ("niche+type", b["niche"], b["mt"])


def stats(rows):
    n = len(rows)
    wr = sum(r["won"] for r in rows) / n
    ap = sum(r["p"] for r in rows) / n
    fee = sum(r["fee"] for r in rows) / n
    edge_t = wr - ap - fee - SLIPPAGE
    edge_m = wr - ap
    # event-clustered standard error of the per-bet residual (won - p)
    by_ev = defaultdict(float)
    for r in rows:
        by_ev[r["ev"]] += r["won"] - r["p"] - (wr - ap)
    se = math.sqrt(sum(v * v for v in by_ev.values())) / n if n else 1
    return dict(n=n, events=len(by_ev), win_rate=round(wr, 4), avg_price=round(ap, 4),
                avg_fee=round(fee, 4), edge_taker=round(edge_t, 4), edge_maker=round(edge_m, 4),
                se=round(se, 4), t_taker=round(edge_t / se, 2) if se else 0,
                t_maker=round(edge_m / se, 2) if se else 0)


def group(rows):
    g = defaultdict(list)
    for b in rows:
        for scope, key, mt in scopes(b):
            g[(scope, key, mt, b["h"], band(b["p"]))].append(b)
    return g


def main():
    markets = {m["id"]: m for m in jl_read(os.path.join(D, "sample.jsonl"))}
    snaps = jl_read(os.path.join(D, "snapshots.jsonl"))
    import time
    allb = [b for b in bets(markets, snaps) if b["ts"] < time.time() - EXCLUDE_RECENT_DAYS * 86400]
    ts = sorted({b["ts"] for b in allb})
    cut = ts[int(len(ts) * 0.7)]
    train = [b for b in allb if b["ts"] < cut]
    test = [b for b in allb if b["ts"] >= cut]
    gtr, gte = group(train), group(test)

    groups = []
    for k, rows in gtr.items():
        if len(rows) < MIN_N:
            continue
        s = stats(rows)
        if s["events"] < MIN_EVENTS:
            continue
        te = gte.get(k)
        t = stats(te) if te and len(te) >= 30 else None
        groups.append(dict(scope=k[0], key=k[1], market_type=k[2], horizon_h=k[3],
                           band_lo=k[4], band_hi=round(k[4] + BAND, 2), train=s, test=t))

    def pick(gs, edge, tcol, tmin=2.0):
        return [g for g in gs if g["train"][edge] > 0 and g["train"][tcol] >= tmin]

    lines = ["# Kismet backtest (Polymarket)", ""]
    lines.append(f"Markets sampled: {len(markets):,} | snapshots: {len(snaps):,} | bets: {len(allb):,}")
    lines.append(f"Train: {len(train):,} bets resolved before cutoff | Test: {len(test):,} bets after")
    lines.append(f"Fees: Polymarket taker formula by category; slippage assumed {SLIPPAGE*100:.1f}c for takers")
    lines.append("")
    for label, edge, tcol in (("TAKER (market orders, pay fee)", "edge_taker", "t_taker"),
                              ("MAKER (limit orders, no fee)", "edge_maker", "t_maker")):
        for scope in ("category", "niche", "niche+type"):
            sel = [g for g in pick(groups, edge, tcol) if g["scope"] == scope and g["test"]]
            if not sel:
                lines.append(f"- {label} / {scope}: no groups pass on train")
                continue
            tot_n = sum(g["test"]["n"] for g in sel)
            pooled = sum(g["test"][edge] * g["test"]["n"] for g in sel) / tot_n
            trn = sum(g["train"][edge] * g["train"]["n"] for g in sel) / sum(g["train"]["n"] for g in sel)
            held = sum(1 for g in sel if g["test"][edge] > 0)
            lines.append(f"- {label} / {scope}: {len(sel)} groups flagged on train "
                         f"(avg edge {trn*100:+.2f}c) -> on test: avg edge {pooled*100:+.2f}c "
                         f"over {tot_n:,} bets, {held}/{len(sel)} groups still positive")
    lines.append("")
    lines.append("## Calibration, all markets, 24h before resolution (test set)")
    lines.append("| price band | bets | win rate | avg price | edge (taker) |")
    lines.append("|---|---|---|---|---|")
    for g in sorted([g for g in groups if g["scope"] == "all" and g["horizon_h"] == 24],
                    key=lambda g: g["band_lo"]):
        t = g["test"]
        if t:
            lines.append(f"| {g['band_lo']:.2f}-{g['band_hi']:.2f} | {t['n']:,} | {t['win_rate']:.3f} | "
                         f"{t['avg_price']:.3f} | {t['edge_taker']*100:+.2f}c |")
    lines.append("")
    lines.append("## Top groups by train taker edge (t >= 2), with test result")
    lines.append("| scope | key | type | hrs | band | train n | train edge | test n | test edge |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    top = sorted(pick(groups, "edge_taker", "t_taker"), key=lambda g: -g["train"]["edge_taker"])[:40]
    for g in top:
        t = g["test"]
        lines.append(f"| {g['scope']} | {g['key']} | {g['market_type']} | {g['horizon_h']} | "
                     f"{g['band_lo']:.2f}-{g['band_hi']:.2f} | {g['train']['n']:,} | "
                     f"{g['train']['edge_taker']*100:+.2f}c | {t['n'] if t else 0:,} | "
                     f"{(t['edge_taker']*100 if t else float('nan')):+.2f}c |")

    os.makedirs(O, exist_ok=True)
    with open(os.path.join(O, "backtest.md"), "w") as f:
        f.write("\n".join(lines) + "\n")

    # Table for the product: rebuilt on ALL data so live flags use everything we know.
    gall = group(allb)
    pub = []
    for k, rows in gall.items():
        if len(rows) < MIN_N:
            continue
        s = stats(rows)
        if s["events"] < MIN_EVENTS:
            continue
        tr = next((g for g in groups if (g["scope"], g["key"], g["market_type"], g["horizon_h"],
                                         g["band_lo"]) == k), None)
        pub.append(dict(scope=k[0], key=k[1], market_type=k[2], horizon_h=k[3], band_lo=k[4],
                        band_hi=round(k[4] + BAND, 2), **s,
                        held_out_edge_taker=(tr["test"]["edge_taker"] if tr and tr["test"] else None),
                        held_out_edge_maker=(tr["test"]["edge_maker"] if tr and tr["test"] else None)))
    with open(os.path.join(O, "edges.json"), "w") as f:
        json.dump(dict(generated_from=len(markets), slippage=SLIPPAGE, band=BAND,
                       horizons_h=sorted({g["horizon_h"] for g in pub}), groups=pub), f)
    print("\n".join(lines[:20]))
    print(f"\nwrote {len(pub)} groups -> output/edges.json")


if __name__ == "__main__":
    main()
