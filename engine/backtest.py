"""Walk-forward backtest: the honest test of whether flags make money.

For each fold (a week, newest folds last): fit the model ONLY on markets that
resolved before the fold started, flag bets inside the fold with the exact
live rule, and score what those flags actually returned. Repeated for several
recency half-lives so the engine can pick how fast old data should fade.

pnl per $1-payout share, taker:  won - price - fee - slippage
pnl per share, maker (limit):    won - price          (assumes the order fills)
"""
import json
import math

import numpy as np

from .model import Model, DAY


def slippage(cfg, b):
    """Per-bet taker cost above the history price. Default ("taker_price": "mid" or unset): half the LIVE median
    spread for that niche and market type (output/spreads.json, written by every scan), never below the config floor.

    "taker_price": "ask" (T-296, off by default): where a niche|market type has a calibrated premium (what the real
    asks logged in the live ledger paid over the same history price at flag time; output/ask_premium.json from
    scripts/ledger/calibrate_ask.py), charge that instead; elsewhere keep the half-spread charge, and with neither,
    the category's premium, else the overall one. Never below the floor. Measured on bets the live rule flagged, so
    the premium is biased low (flags fire where the ask sits close to the price); see docs/research/live-vs-backtest.md."""
    import os
    slip = np.full(b.n, float(cfg.taker_slippage))
    ask = cfg.taker_price == "ask"
    sp_p, pr_p = cfg.path("output", "spreads.json"), cfg.path("output", "ask_premium.json")
    if ask and not os.path.exists(pr_p):
        raise FileNotFoundError(f"taker_price=ask needs {pr_p} (scripts/ledger/calibrate_ask.py)")
    sp = json.load(open(sp_p)) if os.path.exists(sp_p) else {}
    pr = json.load(open(pr_p)) if ask else {}
    cats = b.vocab.get("cat") or []
    for ni, niche in enumerate(b.vocab["niche"]):
        for ti, mt in enumerate(b.vocab["mt"]):
            key = f"{niche}|{mt}"
            sel = (b.niche == ni) & (b.mt == ti)
            if ask and key in pr:
                slip[sel] = max(cfg.taker_slippage, pr[key]["median"])
            elif key in sp:
                slip[sel] = max(cfg.taker_slippage, sp[key]["median"] / 2)
            elif ask and sel.any():  # seen neither live nor in a scan: the category's premium, else the overall one
                for c in np.unique(b.cat[sel]):
                    s = pr.get(f"cat:{cats[c]}") if len(cats) else None
                    s = s or pr.get("all")
                    if s:
                        slip[sel & (b.cat == c)] = max(cfg.taker_slippage, s["median"])
    return slip


def flag_mask(cfg, b, q, lo, maker=False, tight=False):
    fee = 0 if maker else b.fee_rate * b.p * (1 - b.p)
    slip = 0 if maker else (cfg.taker_slippage if tight else slippage(cfg, b))
    cost = b.p + fee + slip
    ok = (b.p >= cfg.price_min) & (b.p < cfg.price_max) & ~np.isnan(q)
    if cfg.flag_max_edge is not None:  # T-296: same optional edge cap as the live rule (scan.under_edge_cap)
        ok = ok & (q - cost < cfg.flag_max_edge)
    return ok & (q - cost >= cfg.flag_min_edge) & (lo - cost > 0), cost


def cap_mask(mask, ev, h, score, k):
    """At most k flags per (event, horizon), the best `score` first: the backtest twin of scan.cap_per_event
    (docs/OVERHAUL.md §G5). A test row is one market at one time-to-close, i.e. one scan's view of it, so the cap
    is per game per scan time. k None/0 = no cap."""
    if not k or not mask.any():
        return mask
    idx = np.where(mask)[0]
    order = idx[np.lexsort((-score[idx], h[idx], ev[idx]))]
    g = np.stack([ev[order], h[order]], 1)
    new = np.ones(len(order), bool)
    new[1:] = (g[1:] != g[:-1]).any(1)
    start = np.maximum.accumulate(np.where(new, np.arange(len(order)), 0))
    out = np.zeros_like(mask)
    out[order[np.arange(len(order)) - start < k]] = True
    return out


def clustered_t(pnl, ev):
    if len(pnl) < 2:
        return 0.0
    r = pnl - pnl.mean()
    S = np.bincount(ev, weights=r)
    se = math.sqrt((S ** 2).sum()) / len(pnl)
    return float(pnl.mean() / se) if se > 0 else 0.0


def score(b, mask, cost):
    pnl = b.y[mask] - cost[mask]
    n = int(mask.sum())
    if n == 0:
        return dict(flags=0)
    return dict(flags=n, events=int(len(np.unique(b.ev[mask]))),
                win_rate=round(float(b.y[mask].mean()), 4),
                avg_price=round(float(b.p[mask].mean()), 4),
                pnl_cents_per_share=round(float(pnl.mean() * 100), 2),
                roi_pct=round(float(pnl.sum() / cost[mask].sum() * 100), 2),
                t_stat=round(clustered_t(pnl, b.ev[mask]), 2))


PAYS_BANDS = [("<1.5x", 1.0, 1.5), ("1.5-2x", 1.5, 2.0), ("2-3x", 2.0, 3.0),
              ("3-5x", 3.0, 5.0), ("5-10x", 5.0, 10.0), ("10x+", 10.0, float("inf"))]


def pays_band(p):
    """Payout band of a $1-payout share bought at price p (pays = 1 / p)."""
    x = round(1.0 / p, 9)  # 1 / 0.1 must land in 10x+, not 9.999...
    return next(name for name, lo, hi in PAYS_BANDS if lo <= x < hi)


def node_neff(m, b):
    """Effective sample size of the model node that answers each bet (nan if none)."""
    out = np.full(b.n, np.nan)
    combos = np.stack([b.h, b.cat, b.niche, b.mt], 1)
    uniq, inv = np.unique(combos, axis=0, return_inverse=True)
    inv = inv.ravel()
    for i, (h, c, nc, t) in enumerate(uniq):
        found = m.node_for(int(h), int(c), int(nc), int(t))
        if found:
            out[inv == i] = found[1]["neff"]
    return out


def edge_mask(cfg, b, q, neff, cost, best):
    """Tier "edge" (docs/18 §2): edge after fee and spread >= min_edge at any payout,
    lower price floor, model node with enough data; never a bet that is already tier "best".
    (The live rule also needs an order book; history has none, so that part is scan-only.)"""
    et = cfg.edge_tier or {}
    ok = (b.p >= et.get("price_min", 0.03)) & (b.p < cfg.price_max) & ~np.isnan(q)
    return ok & (q - cost >= cfg.flag_min_edge) & (np.nan_to_num(neff) >= et.get("min_neff", 40)) & ~best


def by_pays(b, mask, cost, q):
    """Record per payout band: the BacktestRecord fields plus predicted_win_rate (mean model q)."""
    band = np.array([pays_band(p) for p in b.p]) if b.n else np.array([], str)
    out = {}
    for name, _, _ in PAYS_BANDS:
        sel = mask & (band == name)
        r = score(b, sel, cost)
        if r["flags"]:
            r["predicted_win_rate"] = round(float(q[sel].mean()), 4)
        out[name] = r
    return out


def combo_backtest(y, q, cost, ts, ev, legs, per_day=20, seed=7):
    """Random `legs`-leg combos of tier-"best" test bets that resolved the same UTC day,
    one leg per event (same-event legs are correlated). Combo wins if every leg wins; its
    price is the product of the legs' all-in costs, its predicted chance the product of q.
    Deterministic for a given seed."""
    rng = np.random.default_rng(seed)
    day = np.floor(ts / DAY).astype(np.int64)
    W, Q, C, D = [], [], [], []
    for d in np.unique(day):
        idx = np.where(day == d)[0]
        events = {}
        for i in idx:
            events.setdefault(int(ev[i]), []).append(i)
        keys = sorted(events)
        if len(keys) < legs:
            continue
        seen = set()
        for _ in range(per_day * 3):
            if len(seen) >= per_day:
                break
            pick = tuple(sorted(int(rng.choice(events[k])) for k in rng.choice(keys, legs, replace=False)))
            if pick in seen:
                continue
            seen.add(pick)
            sel = list(pick)
            W.append(float(np.prod(y[sel]))); Q.append(float(np.prod(q[sel])))
            C.append(float(np.prod(cost[sel]))); D.append(int(d))
    if not W:
        return dict(combos=0)
    W, Q, C, D = map(np.array, (W, Q, C, D))
    pnl = W - C
    _, dcode = np.unique(D, return_inverse=True)
    return dict(combos=int(len(W)), win_rate=round(float(W.mean()), 4),
                predicted_win_rate=round(float(Q.mean()), 4), avg_pays=round(float((1 / C).mean()), 2),
                roi_pct=round(float(pnl.sum() / C.sum() * 100), 2),
                t_stat=round(clustered_t(pnl, dcode.ravel()), 2))


def run(cfg, b, half_lives=None, log=print):
    half_lives = half_lives if half_lives is not None else cfg.half_life_grid
    wf = cfg.walk_forward
    end = b.ts.max() - cfg.settle_days * DAY
    starts = [end - (i + 1) * wf["test_days"] * DAY for i in reversed(range(wf["folds"]))]
    results, combos, tested = {}, {}, 0
    for hl in half_lives:
        allm, allc, allmk, allmc, test_idx = [], [], [], [], []
        allt, alltc, allq, alle = [], [], [], []
        fold_rows = []
        for s in starts:
            train = b.ts < s
            test = (b.ts >= s) & (b.ts < s + wf["test_days"] * DAY)
            if train.sum() < 1000 or test.sum() == 0:
                continue
            m = Model(cfg, b.vocab, hl).fit(b.take(train), asof=s)
            tb = b.take(test)
            q, lo, _ = m.predict_bets(tb)
            fm, cost = flag_mask(cfg, tb, q, lo)
            mm, mcost = flag_mask(cfg, tb, q, lo, maker=True)
            tm, tcost = flag_mask(cfg, tb, q, lo, tight=True)
            k = cfg.get("max_best_per_event", 2)  # Best bets per game, as the live scan picks them
            fm, mm, tm = (cap_mask(m_, tb.ev, tb.h, q - c_, k) for m_, c_ in ((fm, cost), (mm, mcost), (tm, tcost)))
            allt.append(tm); alltc.append(tcost); allq.append(q)
            alle.append(edge_mask(cfg, tb, q, node_neff(m, tb), cost, fm))
            fold_rows.append(dict(start=int(s), **score(tb, fm, cost)))
            allm.append(fm); allc.append(cost); allmk.append(mm); allmc.append(mcost)
            test_idx.append(np.where(test)[0])
        if not test_idx:
            continue
        idx = np.concatenate(test_idx)
        tb = b.take(idx)
        tested = int(tb.n)
        fm, cost = np.concatenate(allm), np.concatenate(allc)
        mm, mcost = np.concatenate(allmk), np.concatenate(allmc)
        tm, tcost = np.concatenate(allt), np.concatenate(alltc)
        qq = np.concatenate(allq)
        em = np.concatenate(alle)
        # do predicted edges come true? (used to show a realistic edge in the app)
        pe = qq - cost
        edge_buckets = []
        for lo_e, hi_e in ((0.02, 0.05), (0.05, 0.10), (0.10, 0.15), (0.15, 1.0)):
            sel = fm & (pe >= lo_e) & (pe < hi_e)
            if sel.any():
                edge_buckets.append(dict(predicted_lo=lo_e, predicted_hi=hi_e, flags=int(sel.sum()),
                                         predicted_edge=round(float(pe[sel].mean()), 4),
                                         realized_edge=round(float((tb.y[sel] - cost[sel]).mean()), 4)))
        by_cat_tight = {c: score(tb, tm & (tb.cat == ci), tcost)
                        for ci, c in enumerate(b.vocab["cat"]) if (tm & (tb.cat == ci)).any()}
        by_cat = {}
        for ci, c in enumerate(b.vocab["cat"]):
            sel = fm & (tb.cat == ci)
            if sel.any():
                by_cat[c] = score(tb, sel, cost)
        by_h = {int(h): score(tb, fm & (tb.h == h), cost) for h in np.unique(tb.h)}
        base = np.ones(tb.n, bool) & (tb.p >= cfg.price_min) & (tb.p < cfg.price_max)
        results[str(hl)] = dict(
            half_life_days=hl, taker=score(tb, fm, cost), maker=score(tb, mm, mcost),
            taker_tight_spread=score(tb, tm, tcost), by_category_tight_spread=by_cat_tight,
            edge_buckets=edge_buckets,
            baseline_all_bets_taker=score(tb, base, cost), by_category=by_cat,
            by_horizon=by_h, folds=fold_rows,
            by_pays=dict(best=by_pays(tb, fm, cost, qq), edge=by_pays(tb, em, cost, qq)))
        # combos of tier-"best" test bets only: every leg was predicted by a model fit before its fold
        combos[str(hl)] = {str(k): combo_backtest(tb.y[fm], qq[fm], cost[fm], tb.ts[fm], tb.ev[fm], k)
                           for k in (2, 3)}
        t = results[str(hl)]["taker"]
        log(f"half-life {hl}: taker flags={t.get('flags')} pnl={t.get('pnl_cents_per_share')}c "
            f"roi={t.get('roi_pct')}% t={t.get('t_stat')}")
    # tested_bets: every bet scored out of sample (all folds, any price); the same for each half-life
    ran = max((len(r["folds"]) for r in results.values()), default=0)
    return dict(test_days=wf["test_days"], folds=len(starts), folds_run=ran, results=results,
                tested_bets=tested, combos_by_half_life=combos)


def pick_half_life(bt, min_flags=300):
    """Best risk-adjusted taker result: highest t-stat among runs with enough flags."""
    best, best_t, found = None, -1e9, False
    for k, r in bt["results"].items():
        t = r["taker"]
        if t.get("flags", 0) >= min_flags and t["t_stat"] > best_t:
            best, best_t, found = r["half_life_days"], t["t_stat"], True
    return found, best  # best=None is valid: "no decay" won
