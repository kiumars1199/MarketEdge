"""T-296: optional cap on a Best bet's predicted edge (config `flag_max_edge`, default off).
Live and the walk-forward test must apply the same rule (docs/research/live-vs-backtest.md)."""
import json
import os

import numpy as np

from engine import backtest
from engine.config import ROOT
from engine.scan import is_best, under_edge_cap
from engine.tests.test_engine import cfg, synthetic


def row(mid, q, lo=None, validated=True, fee_rate=0.05):
    fee = fee_rate * mid * (1 - mid)
    return {"validated": validated,
            "best": dict(mid=mid, ask=mid, fee=fee, win_prob=q, edge=q - mid - fee,
                         edge_low=(lo if lo is not None else q) - mid - fee)}


def test_cap_is_off_by_default(tmp_path):
    c = cfg(tmp_path)
    assert c.flag_max_edge is None
    assert under_edge_cap(c, 0.50)
    assert is_best(c, row(0.70, 0.95))            # edge ~24c: a Best bet with the cap off


def test_cap_drops_only_large_predicted_edges(tmp_path):
    c = cfg(tmp_path, flag_max_edge=0.10)
    assert is_best(c, row(0.70, 0.78))            # edge ~7c: kept
    assert not is_best(c, row(0.70, 0.95))        # edge ~24c: over the cap
    assert not under_edge_cap(c, 0.10)            # the cap itself is excluded (edge < cap)
    assert under_edge_cap(c, 0.0999)


def test_other_rules_unchanged(tmp_path):
    c = cfg(tmp_path, flag_max_edge=0.10)
    assert not is_best(c, row(0.70, 0.71))        # under the 2c minimum
    assert not is_best(c, row(0.70, 0.78, lo=0.70))   # pessimistic edge <= 0
    assert not is_best(c, row(0.70, 0.78, validated=False))
    assert is_best(c, row(0.70, 0.78, validated=False), has_record=False)  # no backtest yet: no validation gate


def test_backtest_flag_mask_applies_the_same_cap(tmp_path):
    b = synthetic(3, np.zeros(3))
    b.p = np.array([0.70, 0.70, 0.70])
    q = np.array([0.78, 0.95, 0.71])
    lo = q.copy()
    off, _ = backtest.flag_mask(cfg(tmp_path), b, q, lo, tight=True)
    on, _ = backtest.flag_mask(cfg(tmp_path, flag_max_edge=0.10), b, q, lo, tight=True)
    assert off.tolist() == [True, True, False]
    assert on.tolist() == [True, False, False]


def test_shipped_config_keeps_it_off():
    d = json.load(open(os.path.join(ROOT, "config", "demo.json")))
    assert "flag_max_edge" in d and d["flag_max_edge"] is None
