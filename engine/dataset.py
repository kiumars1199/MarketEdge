"""Turn raw markets + price snapshots into a compact array of bets.

Each snapshot (price p of outcome A, N hours before resolution) becomes two bets:
buy A at p, or buy B at 1 - p. Arrays are numpy so fits and backtests are fast.
"""
import json
import os

import numpy as np

from pipeline.common import classify, jl_read, FEE_RATE

HORIZONS = [1, 6, 24, 72, 168]


def market_type(category, sports_type, neg_risk):
    if category == "sports":
        t = sports_type
        if t in (None, "moneyline"):
            return "moneyline"
        if "spread" in t:
            return "spreads"
        if "total" in t:
            return "totals"
        return "props"
    return "multi-outcome" if neg_risk else "yes/no"


class Bets:
    """Column arrays. String columns are stored as int codes + a vocabulary."""

    def __init__(self, cols, vocab):
        self.__dict__.update(cols)
        self.vocab = vocab
        self.n = len(cols["p"])

    def take(self, mask):
        cols = {k: v[mask] for k, v in self.__dict__.items() if isinstance(v, np.ndarray)}
        return Bets(cols, self.vocab)

    def code(self, field, value):
        return self.vocab[field].index(value) if value in self.vocab[field] else -1


def load(cfg):
    markets = {m["id"]: m for m in jl_read(cfg.path("data", "sample.jsonl"))}
    snaps = jl_read(cfg.path("data", "snapshots.jsonl"))
    vocab = {"cat": [], "niche": [], "mt": []}
    idx = {k: {} for k in vocab}

    def enc(field, v):
        d = idx[field]
        if v not in d:
            d[v] = len(vocab[field])
            vocab[field].append(v)
        return d[v]

    ev_idx = {}
    rows = []
    seen = set()
    for s in snaps:
        key = (s["id"], s["h"])
        m = markets.get(s["id"])
        if not m or key in seen:
            continue
        seen.add(key)
        # re-classify from the stored tags so niche/category list changes apply on refit
        cat, niche = classify(m["tags"]) if m.get("tags") else (m["category"], m["niche"])
        mt = market_type(cat, m.get("market_type"), m.get("neg_risk"))
        c, n, t = enc("cat", cat), enc("niche", niche), enc("mt", mt)
        e = ev_idx.setdefault(m["event_id"], len(ev_idx))
        for side in (0, 1):
            p = s["p"] if side == 0 else 1 - s["p"]
            y = m["yes_won"] if side == 0 else 1 - m["yes_won"]
            rows.append((p, y, s["h"], m["ref_ts"], c, n, t, e, int(m["id"]), side))
    a = np.array(rows, dtype=np.float64)
    cols = dict(p=a[:, 0], y=a[:, 1], h=a[:, 2].astype(int), ts=a[:, 3], cat=a[:, 4].astype(int),
                niche=a[:, 5].astype(int), mt=a[:, 6].astype(int), ev=a[:, 7].astype(int),
                mid=a[:, 8].astype(np.int64), side=a[:, 9].astype(int))
    b = Bets(cols, vocab)
    b.fee_rate = np.array([FEE_RATE.get(c, 0.05) for c in vocab["cat"]])[b.cat]
    return b


def summary(b):
    out = {"bets": int(b.n), "markets": int(len(np.unique(b.mid))), "events": int(len(np.unique(b.ev)))}
    out["by_category"] = {c: int((b.cat == i).sum() // 2) for i, c in enumerate(b.vocab["cat"])}
    return out
