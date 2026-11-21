"""Hierarchical, recency-weighted calibration model.

For a bet bought at price p, the model estimates the true win probability q:
    q = sigmoid( theta . basis(logit p) )
basis = [1, x, relu(x - k1), relu(x - k2), relu(x - k3)], knots at 30c / 50c / 70c.
A perfectly priced market is theta = [0, 1, 0, 0, 0].

One theta per node, fitted separately for each horizon (hours before resolution):
    all  ->  category  ->  niche  ->  niche + market type
Each node is pulled toward its parent (a Gaussian prior, strength = prior_strength
in "effective bets"), so small niches borrow strength and big ones speak for
themselves. Every bet is weighted by 0.5 ** (age / half_life), so recent trading
patterns dominate and old ones fade. Standard errors are inflated by the
within-event clustering (design effect), since one game produces many markets.
"""
import json
import math

import numpy as np

KNOTS = np.array([math.log(0.3 / 0.7), 0.0, math.log(0.7 / 0.3)])
PERFECT = np.array([0.0, 1.0, 0.0, 0.0, 0.0])
DAY = 86400.0


def logit(p):
    p = np.clip(p, 0.01, 0.99)
    return np.log(p / (1 - p))


def basis(p):
    x = logit(np.asarray(p, dtype=float))
    return np.column_stack([np.ones_like(x), x] + [np.maximum(0, x - k) for k in KNOTS])


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def fit_node(X, y, w, mu, lam, ev):
    th = mu.copy()
    I = np.eye(len(mu))
    for _ in range(30):
        q = sigmoid(X @ th)
        g = X.T @ (w * (q - y)) + lam * (th - mu)
        H = (X * (w * q * (1 - q))[:, None]).T @ X + lam * I
        step = np.linalg.solve(H, g)
        th -= step
        if np.abs(step).max() < 1e-7:
            break
    # design effect: bets in the same event are not independent
    W_e = np.bincount(ev, weights=w)
    deff = max(1.0, float((W_e ** 2).sum() / max((w ** 2).sum(), 1e-12)))
    cov = np.linalg.inv(H) * deff
    return th, cov, deff


class Model:
    def __init__(self, cfg, vocab, half_life_days):
        self.cfg, self.vocab, self.hl = cfg, vocab, half_life_days
        self.nodes = {}       # key -> dict(theta, cov, neff, events, n)
        self.parent_cat = {}  # niche code -> category code

    @staticmethod
    def keys(h, cat, niche, mt):
        return [("all", h), ("cat", h, cat), ("niche", h, niche), ("nmt", h, niche, mt)]

    def fit(self, b, asof):
        cfg = self.cfg
        age = np.maximum(0.0, (asof - b.ts) / DAY)
        w = np.ones(b.n) if not self.hl else 0.5 ** (age / self.hl)
        X = basis(b.p)
        lam = float(cfg.prior_strength)
        # niche -> its most common category
        for nc in np.unique(b.niche):
            cats = b.cat[b.niche == nc]
            self.parent_cat[int(nc)] = int(np.bincount(cats).argmax())
        for h in np.unique(b.h):
            H = b.h == h
            self._fit(("all", int(h)), H, X, b, w, PERFECT, lam)
            if ("all", int(h)) not in self.nodes:  # too few bets at this horizon (early folds)
                continue
            root = self.nodes[("all", int(h))]["theta"]
            for c in np.unique(b.cat[H]):
                self._fit(("cat", int(h), int(c)), H & (b.cat == c), X, b, w, root, lam)
            for nc in np.unique(b.niche[H]):
                par = self.nodes.get(("cat", int(h), self.parent_cat[int(nc)]), {"theta": root})["theta"]
                self._fit(("niche", int(h), int(nc)), H & (b.niche == nc), X, b, w, par, lam)
            for nc in np.unique(b.niche[H]):
                par = self.nodes.get(("niche", int(h), int(nc)),
                                     self.nodes.get(("cat", int(h), self.parent_cat[int(nc)]),
                                                    {"theta": root}))["theta"]
                for t in np.unique(b.mt[H & (b.niche == nc)]):
                    self._fit(("nmt", int(h), int(nc), int(t)), H & (b.niche == nc) & (b.mt == t),
                              X, b, w, par, lam)
        return self

    def _fit(self, key, mask, X, b, w, mu, lam):
        if mask.sum() < 20:
            return
        th, cov, deff = fit_node(X[mask], b.y[mask], w[mask], mu, lam, b.ev[mask])
        ww = w[mask]
        self.nodes[key] = dict(theta=th, cov=cov, deff=deff, n=int(mask.sum()),
                               neff=float(ww.sum() ** 2 / (ww ** 2).sum() / deff),
                               events=int(len(np.unique(b.ev[mask]))))

    def node_for(self, h, cat, niche, mt):
        """Most specific node with enough (recency-weighted) data."""
        best = None
        for k in self.keys(h, cat, niche, mt):
            nd = self.nodes.get(k)
            if nd is None:
                continue
            if best is None or (nd["neff"] >= self.cfg.min_node_neff
                                and nd["events"] >= self.cfg.min_node_events):
                best = (k, nd)
        return best

    def predict(self, p, h, cat, niche, mt, z=None):
        """Vectorised over p for one segment. Returns q, q_lo, node key, node."""
        found = self.node_for(h, cat, niche, mt)
        if not found:
            return None
        k, nd = found
        X = basis(np.atleast_1d(p))
        eta = X @ nd["theta"]
        se = np.sqrt(np.einsum("ij,jk,ik->i", X, nd["cov"], X))
        z = self.cfg.flag_confidence_z if z is None else z
        return sigmoid(eta), sigmoid(eta - z * se), k, nd

    def predict_bets(self, b, z=None):
        """Predict for every bet in b. Returns q, q_lo, node_level (0-3)."""
        q = np.full(b.n, np.nan)
        lo = np.full(b.n, np.nan)
        lvl = np.full(b.n, -1)
        combos = np.stack([b.h, b.cat, b.niche, b.mt], 1)
        uniq, inv = np.unique(combos, axis=0, return_inverse=True)
        inv = inv.ravel()
        for i, (h, c, nc, t) in enumerate(uniq):
            m = inv == i
            r = self.predict(b.p[m], int(h), int(c), int(nc), int(t), z)
            if r is None:
                continue
            q[m], lo[m] = r[0], r[1]
            lvl[m] = ["all", "cat", "niche", "nmt"].index(r[2][0])
        return q, lo, lvl

    # ---- serialisation (output/model.json is what the scanner + UI read) ----
    def to_json(self):
        def name(k):
            lvl, h = k[0], k[1]
            if lvl == "all":
                return dict(level="all", horizon_h=h, key="all", market_type="all")
            if lvl == "cat":
                return dict(level="category", horizon_h=h, key=self.vocab["cat"][k[2]], market_type="all")
            if lvl == "niche":
                return dict(level="niche", horizon_h=h, key=self.vocab["niche"][k[2]], market_type="all")
            return dict(level="niche+type", horizon_h=h, key=self.vocab["niche"][k[2]],
                        market_type=self.vocab["mt"][k[3]])
        nodes = []
        for k, nd in self.nodes.items():
            curve = {f"{p:.2f}": round(float(sigmoid(basis([p])[0] @ nd["theta"])), 4)
                     for p in np.round(np.arange(0.05, 0.96, 0.05), 2)}
            nodes.append(dict(**name(k), theta=[round(float(t), 5) for t in nd["theta"]],
                              cov=[[float(c) for c in row] for row in nd["cov"]],
                              n=nd["n"], neff=round(nd["neff"], 1), events=nd["events"],
                              deff=round(nd["deff"], 2), win_prob_at_price=curve))
        return dict(half_life_days=self.hl, knots=KNOTS.tolist(), vocab=self.vocab,
                    parent_category={self.vocab["niche"][k]: self.vocab["cat"][v]
                                     for k, v in self.parent_cat.items()}, nodes=nodes)

    @classmethod
    def from_json(cls, cfg, d):
        m = cls(cfg, d["vocab"], d["half_life_days"])
        V = d["vocab"]
        m.parent_cat = {V["niche"].index(k): V["cat"].index(v) for k, v in d["parent_category"].items()}
        for nd in d["nodes"]:
            h = nd["horizon_h"]
            if nd["level"] == "all":
                k = ("all", h)
            elif nd["level"] == "category":
                k = ("cat", h, V["cat"].index(nd["key"]))
            elif nd["level"] == "niche":
                k = ("niche", h, V["niche"].index(nd["key"]))
            else:
                k = ("nmt", h, V["niche"].index(nd["key"]), V["mt"].index(nd["market_type"]))
            m.nodes[k] = dict(theta=np.array(nd["theta"]), cov=np.array(nd["cov"]), n=nd["n"],
                              neff=nd["neff"], events=nd["events"], deff=nd["deff"])
        return m
