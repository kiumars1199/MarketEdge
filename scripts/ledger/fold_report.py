"""Walk-forward test, mid vs ask pricing, filters chosen on older folds, results per event (T-296).

Same folds, model fit and flag rule as engine/backtest.run (one half-life, default production's chosen 90 d), but
it keeps every flagged bet so it can report what backtest.json cannot:

  1. per fold, mid pricing (half the live median spread, today's default) vs ask pricing (the premium real live
     asks paid over the history price, output/ask_premium.json from calibrate_ask.py);
  2. filters (categories, time-to-close, "validated", edge cap) CHOSEN on the older folds only, then REPORTED on
     the newest --holdout folds only;
  3. every result per event: each game or weather day counted once (its bets averaged), not per bet.

    python3 scripts/ledger/fold_report.py config/demo.json ask_premium.json [--half-life 90] [--holdout 8] [--json out.json]
Uses the config's data_dir (data/sample.jsonl + snapshots.jsonl) and output_dir/spreads.json for mid pricing.
"""
import argparse
import itertools
import json
import os
import shutil
import sys
import tempfile
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from engine import backtest, dataset  # noqa: E402
from engine.config import Config, load  # noqa: E402
from engine.model import DAY, Model  # noqa: E402

MIN_EVENTS = 30   # fewest older-fold events behind a category/horizon decision
CAP = 0.10        # the flag_max_edge value studied in docs/research/live-vs-backtest.md


def walk(cfg, b, hl, log=print):
    """The flagged test bets (at either pricing) with both costs, plus one meta row per fold that ran (every
    weekly fold with >= 1000 training bets and any test bet, flagged or not). Returns (dict of arrays, meta)."""
    wf = cfg.walk_forward
    end = b.ts.max() - cfg.settle_days * DAY
    starts = [end - (i + 1) * wf["test_days"] * DAY for i in reversed(range(wf["folds"]))]
    cols = {k: [] for k in ("fold", "start", "ev", "cat", "h", "p", "y", "q", "neff",
                            "cost_mid", "cost_ask", "flag_mid", "flag_ask", "edge_ask")}
    mid_cfg, ask_cfg = Config(cfg, taker_price="mid"), Config(cfg, taker_price="ask")
    meta = []
    for fi, s in enumerate(starts):
        train = b.ts < s
        test = (b.ts >= s) & (b.ts < s + wf["test_days"] * DAY)
        if train.sum() < 1000 or test.sum() == 0:
            continue
        m = Model(cfg, b.vocab, hl).fit(b.take(train), asof=s)
        tb = b.take(test)
        q, lo, _ = m.predict_bets(tb)
        fm, cm = backtest.flag_mask(mid_cfg, tb, q, lo)
        fa, ca = backtest.flag_mask(ask_cfg, tb, q, lo)
        keep = fm | fa
        ok = (tb.p >= cfg.price_min) & (tb.p < cfg.price_max)
        if not ok.any():
            ok = np.ones(tb.n, bool)
        meta.append(dict(fold=fi, start=int(s), test_bets=int(tb.n), flags_mid=int(fm.sum()), flags_ask=int(fa.sum()),
                         slip_mid_c=round(float((cm - tb.p - tb.fee_rate * tb.p * (1 - tb.p))[ok].mean() * 100), 2),
                         slip_ask_c=round(float((ca - tb.p - tb.fee_rate * tb.p * (1 - tb.p))[ok].mean() * 100), 2)))
        for k, v in (("fold", np.full(tb.n, fi)), ("start", np.full(tb.n, int(s))), ("ev", tb.ev), ("cat", tb.cat),
                     ("h", tb.h), ("p", tb.p), ("y", tb.y), ("q", q), ("neff", backtest.node_neff(m, tb)),
                     ("cost_mid", cm), ("cost_ask", ca), ("flag_mid", fm), ("flag_ask", fa), ("edge_ask", q - ca)):
            cols[k].append(np.asarray(v)[keep])
        log(f"fold {time.strftime('%Y-%m-%d', time.gmtime(s))}: test bets {tb.n}, flags mid {int(fm.sum())} ask {int(fa.sum())}")
    return {k: np.concatenate(v) if v else np.array([]) for k, v in cols.items()}, meta


def per_event(r, sel, cost):
    """Each event once: its bets' pnl and cost averaged, then events summed. Also the per-bet view and the
    event-clustered t (backtest.clustered_t)."""
    n = int(sel.sum())
    if not n:
        return dict(bets=0, events=0)
    pnl, c, ev = r["y"][sel] - cost[sel], cost[sel], r["ev"][sel]
    u, inv = np.unique(ev, return_inverse=True)
    k = np.bincount(inv)
    ep, ec = np.bincount(inv, pnl) / k, np.bincount(inv, c) / k
    return dict(bets=n, events=int(len(u)),
                roi_bet=round(float(pnl.sum() / c.sum() * 100), 2),
                roi_event=round(float(ep.sum() / ec.sum() * 100), 2),
                pnl_cents_event=round(float(ep.mean() * 100), 2),
                events_won_money=round(float((ep > 0).mean()), 3),
                t=round(backtest.clustered_t(pnl, inv), 2))


def record_ok(r, sel, cost):
    """The live "validated" rule (engine/scan.py): >= 100 flags, positive pnl, t >= 2."""
    s = per_event(r, sel, cost)
    return s["bets"] >= 100 and s["roi_bet"] > 0 and s["t"] >= 2


def choose(r, older, flag, cost, cats, hs):
    """Candidate filters, each decided on older folds only. Returns {name: mask over all rows}."""
    base = flag
    def good(key, vals):
        return [v for v in vals if (s := per_event(r, older & base & (r[key] == v), cost))["events"] >= MIN_EVENTS
                and s["roi_event"] > 0]
    ok_cat, ok_h = good("cat", cats), good("h", hs)
    vcat = [c for c in cats if record_ok(r, older & base & (r["cat"] == c), cost)]
    vh = [h for h in hs if record_ok(r, older & base & (r["h"] == h), cost)]
    cap = (r["q"] - cost) < CAP
    parts = {
        "categories": (np.isin(r["cat"], ok_cat), ok_cat),
        "time-to-close": (np.isin(r["h"], ok_h), ok_h),
        "validated": (np.isin(r["cat"], vcat) & np.isin(r["h"], vh), (vcat, vh)),
        "edge cap 10c": (cap, None),
    }
    out = {"no filter": (base, None)}
    for k in range(1, len(parts) + 1):
        for combo in itertools.combinations(parts, k):
            m = base.copy()
            for c in combo:
                m &= parts[c][0]
            out[" + ".join(combo)] = (m, {c: parts[c][1] for c in combo if parts[c][1] is not None})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("ask_premium")
    ap.add_argument("--half-life", default="90")
    ap.add_argument("--holdout", type=int, default=8)
    ap.add_argument("--json")
    a = ap.parse_args()
    cfg = load(a.config)
    tmp = tempfile.mkdtemp()  # spreads.json (mid) and ask_premium.json (ask) side by side, nothing written to output/
    src = cfg.path("output", "spreads.json")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(tmp, "spreads.json"))
    shutil.copy(a.ask_premium, os.path.join(tmp, "ask_premium.json"))
    cfg = Config(cfg, output_dir=tmp)
    hl = None if a.half_life in ("None", "none") else float(a.half_life)
    b = dataset.load(cfg)
    print(f"data: {dataset.summary(b)}")
    r, meta = walk(cfg, b, hl)
    out = {"data": dataset.summary(b), "half_life": hl, "fold_meta": meta}

    folds = [x["fold"] for x in meta]          # every fold that ran, flagged or not, in calendar order
    starts = {x["fold"]: x["start"] for x in meta}
    tests = {x["fold"]: x["test_bets"] for x in meta}
    day = lambda f: time.strftime("%Y-%m-%d", time.gmtime(starts[f]))  # noqa: E731
    print("\n(1) per fold, mid vs ask pricing, each event once")
    print(f"{'week of':10s} {'tested':>6s} | {'mid: bets':>9s} {'events':>6s} {'ROI/bet':>8s} {'ROI/event':>9s} | "
          f"{'ask: bets':>9s} {'events':>6s} {'ROI/bet':>8s} {'ROI/event':>9s}")
    out["folds"] = []
    for f in folds:
        sf = r["fold"] == f
        m_, k_ = per_event(r, sf & r["flag_mid"], r["cost_mid"]), per_event(r, sf & r["flag_ask"], r["cost_ask"])
        out["folds"].append(dict(start=starts[f], mid=m_, ask=k_))
        g = lambda s, k: s.get(k, "")  # noqa: E731
        print(f"{day(f):10s} {tests[f]:6d} | {m_['bets']:9d} {m_['events']:6d} {g(m_, 'roi_bet'):>8} {g(m_, 'roi_event'):>9} | "
              f"{k_['bets']:9d} {k_['events']:6d} {g(k_, 'roi_bet'):>8} {g(k_, 'roi_event'):>9}")
    tot = {"mid": per_event(r, r["flag_mid"].astype(bool), r["cost_mid"]),
           "ask": per_event(r, r["flag_ask"].astype(bool), r["cost_ask"])}
    out["all_folds"] = tot
    w = np.array([x["test_bets"] for x in meta], float)
    sm = float(np.average([x["slip_mid_c"] for x in meta], weights=w))
    sa = float(np.average([x["slip_ask_c"] for x in meta], weights=w))
    out["mean_slip_cents"] = dict(mid=round(sm, 2), ask=round(sa, 2))
    print(f"mean charge over the history price, all test bets in the price range: mid {sm:.2f}c, ask {sa:.2f}c")
    print(f"all folds  mid {tot['mid']}\n           ask {tot['ask']}")
    total = tot["mid"]["bets"]
    last2 = int((r["flag_mid"] & np.isin(r["fold"], folds[-2:])).sum())
    out["last_two_weeks_share_mid"] = round(last2 / total, 3) if total else None
    print(f"share of mid-priced best bets in the last 2 weeks: {out['last_two_weeks_share_mid']}")

    hold = folds[-a.holdout:]
    newest = np.isin(r["fold"], hold)
    older = ~newest
    print(f"\n(2) filters chosen on folds {day(folds[0])}..{day(folds[-a.holdout - 1])} (older), "
          f"reported on {day(hold[0])}..{day(hold[-1])} (newest {a.holdout}, held out)")
    cats = list(range(len(b.vocab["cat"])))
    hs = sorted(set(r["h"].tolist()))
    out["filters"] = {}
    for price in ("ask", "mid"):
        flag, cost = r[f"flag_{price}"].astype(bool), r[f"cost_{price}"]
        cands = choose(r, older, flag, cost, cats, hs)
        rows = []
        empty = [k for k in ("validated",) if not cands[k][0].any()]
        if empty:
            print(f"\n  {price}: 'validated' selects nothing: no category and time-to-close both reached the live rule "
                  f"(>= 100 flags, profit, t >= 2) on the older folds; combinations with it are left out")
            out.setdefault("validated_empty", []).append(price)
        for name, (m, picked) in cands.items():
            if any(e in name for e in empty):
                continue
            o, n = per_event(r, older & m, cost), per_event(r, newest & m, cost)
            rows.append((name, o, n, picked))
        eligible = [x for x in rows if x[1].get("events", 0) >= 100]
        best = max(eligible, key=lambda x: x[1]["roi_event"]) if eligible else rows[0]
        print(f"\n  {price} pricing   (older: events, ROI/event | newest: events, ROI/event, ROI/bet, t)")
        for name, o, n, picked in rows:
            mark = " <- chosen on older folds" if name == best[0] else ""
            print(f"   {name:58s} {o.get('events', 0):5d} {o.get('roi_event', '-'):>7} | "
                  f"{n.get('events', 0):5d} {n.get('roi_event', '-'):>7} {n.get('roi_bet', '-'):>7} {n.get('t', '-'):>6}{mark}")
        names = lambda p: {k: ([b.vocab["cat"][c] for c in v] if k == "categories" else  # noqa: E731
                                ([b.vocab["cat"][c] for c in v[0]], v[1]) if k == "validated" else v)
                           for k, v in (p or {}).items()}
        print(f"   chosen: {best[0]}  {json.dumps(names(best[3]), default=int)}")
        out["filters"][price] = dict(chosen=best[0], picked=names(best[3]),
                                     rows=[dict(name=n_, older=o, newest=n) for n_, o, n, _ in rows])
    if a.json:
        json.dump(out, open(a.json, "w"), indent=1, default=int)


if __name__ == "__main__":
    main()
