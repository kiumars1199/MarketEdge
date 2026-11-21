"""docs/18: tier assignment, by_pays bands, combo backtest math, and no look-ahead."""
import numpy as np
import pytest

from engine import backtest
from engine.model import Model
from engine.scan import is_edge
from engine.tests.test_engine import DAY, cfg, synthetic


# ---- tiers ----
def row(mid, q, neff=500.0, fee_rate=0.05):
    ask = mid
    fee = fee_rate * ask * (1 - ask)
    return {"best": dict(mid=mid, ask=ask, fee=fee, win_prob=q, edge=q - ask - fee, model_neff=neff)}


def test_ten_x_long_shot_is_tier_edge(tmp_path):
    c = cfg(tmp_path, edge_tier={"price_min": 0.03, "min_neff": 40})
    assert is_edge(c, row(0.10, 0.14))           # pays 10x, our chance 14%: edge 3.55c
    assert is_edge(c, row(0.04, 0.07))           # under the Best-bets 5c floor, above 3c
    assert not is_edge(c, row(0.02, 0.10))       # below the tier price floor
    assert not is_edge(c, row(0.10, 0.11))       # edge after fee < 2c
    assert not is_edge(c, row(0.10, 0.14, neff=39))  # model node too thin


def test_edge_mask_excludes_best_and_needs_neff(tmp_path):
    c = cfg(tmp_path, edge_tier={"price_min": 0.03, "min_neff": 40})
    b = synthetic(4, np.zeros(4))
    b.p = np.array([0.10, 0.10, 0.10, 0.04])
    q = np.array([0.14, 0.14, 0.14, 0.07])
    cost = b.p + 0.005
    best = np.array([True, False, False, False])
    neff = np.array([100, 100, 10, 100.0])
    assert backtest.edge_mask(c, b, q, neff, cost, best).tolist() == [False, True, False, True]


# ---- by_pays ----
@pytest.mark.parametrize("p,band", [(0.9, "<1.5x"), (0.667, "<1.5x"), (0.66, "1.5-2x"), (0.5, "2-3x"), (0.34, "2-3x"),
                                    (0.25, "3-5x"), (0.2, "5-10x"), (0.11, "5-10x"), (0.1, "10x+"),
                                    (0.03, "10x+")])
def test_pays_band_edges(p, band):
    assert backtest.pays_band(p) == band


def test_by_pays_has_every_band_and_predicted_rate():
    b = synthetic(4, np.zeros(4))
    b.p = np.array([0.8, 0.8, 0.1, 0.1])
    b.y = np.array([1.0, 0.0, 1.0, 0.0])
    q = np.array([0.9, 0.9, 0.2, 0.2])
    r = backtest.by_pays(b, np.ones(4, bool), b.p.copy(), q)
    assert [k for k, *_ in backtest.PAYS_BANDS] == list(r)
    assert r["<1.5x"]["flags"] == 2 and r["<1.5x"]["win_rate"] == 0.5
    assert r["<1.5x"]["predicted_win_rate"] == 0.9
    assert r["10x+"]["roi_pct"] == pytest.approx((1 - 0.2) / 0.2 * 100)
    assert r["2-3x"] == {"flags": 0}


# ---- combos ----
def test_combo_math_and_events():
    # one day, three events; event 0 has two bets that must never share a combo
    y = np.array([1.0, 1.0, 0.0, 1.0])
    q = np.array([0.8, 0.8, 0.6, 0.7])
    cost = np.array([0.7, 0.7, 0.5, 0.6])
    ts = np.full(4, 10 * DAY + 5)
    ev = np.array([0, 0, 1, 2])
    r3 = backtest.combo_backtest(y, q, cost, ts, ev, 3)
    # possible 3-leg combos: {0|1} x 2 x 3 -> 2 combos, each loses (event 1 lost)
    assert r3["combos"] == 2 and r3["win_rate"] == 0
    assert r3["predicted_win_rate"] == pytest.approx(0.8 * 0.6 * 0.7, abs=1e-4)
    assert r3["roi_pct"] == -100
    r2 = backtest.combo_backtest(y, q, cost, ts, ev, 2)
    assert r2["combos"] == 5  # pairs across different events: 0-1,0-2 (x2 legs) + 1-2
    assert r2 == backtest.combo_backtest(y, q, cost, ts, ev, 2)  # deterministic


def test_combo_needs_same_day():
    y, q, cost = np.ones(2), np.full(2, 0.8), np.full(2, 0.7)
    ts = np.array([1 * DAY, 2 * DAY + 1])
    assert backtest.combo_backtest(y, q, cost, ts, np.array([0, 1]), 2) == {"combos": 0}


def test_combo_payoff():
    y, q, cost = np.ones(2), np.full(2, 0.8), np.array([0.5, 0.4])
    r = backtest.combo_backtest(y, q, cost, np.zeros(2), np.array([0, 1]), 2)
    assert r["avg_pays"] == 5.0 and r["roi_pct"] == pytest.approx((1 - 0.2) / 0.2 * 100)


# ---- no look-ahead for by_pays and combos ----
def test_by_pays_and_combos_only_score_out_of_sample(tmp_path, monkeypatch):
    fits, legs = [], []

    class Spy(Model):
        def fit(self, b, asof):
            assert (b.ts < asof).all(), "train rows at/after fold start"
            fits.append(asof)
            return super().fit(b, asof)

    real = backtest.combo_backtest

    def spy_combo(y, q, cost, ts, ev, k, **kw):
        legs.append(ts.copy())
        return real(y, q, cost, ts, ev, k, **kw)

    monkeypatch.setattr(backtest, "Model", Spy)
    monkeypatch.setattr(backtest, "combo_backtest", spy_combo)
    n = 20_000
    rng = np.random.default_rng(1)
    b = synthetic(n, rng.uniform(0, 60 * DAY, n))
    b.ev = np.arange(n) // 4  # some multi-bet events
    out = backtest.run(cfg(tmp_path, edge_tier={"price_min": 0.03, "min_neff": 40}), b,
                       half_lives=[None], log=lambda *a: None)
    first = min(fits)
    assert len(fits) == 3 and legs
    for ts in legs:
        assert (ts >= first).all(), "combo leg from a training row"
    r = out["results"]["None"]
    assert set(r["by_pays"]) == {"best", "edge"}
    assert set(out["combos_by_half_life"]["None"]) == {"2", "3"}
    assert out["tested_bets"] == int(((b.ts >= first) & (b.ts < first + 21 * DAY)).sum())
