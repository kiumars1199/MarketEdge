"""Edge cases for execution math, model fit on synthetic data, and backtest no-look-ahead."""
import numpy as np
import pytest

from engine import backtest
from engine.config import Config
from engine.dataset import Bets
from engine.execution import capacity, check, fill
from engine.model import PERFECT, Model

DAY = 86400.0


def book(asks, bids=()):
    lv = lambda xs: [{"price": str(p), "size": str(s)} for p, s in xs]
    return {"asks": lv(asks), "bids": lv(bids)}


# ---- execution ----
def test_no_asks_is_no_sellers():
    assert check(0.6, book([], [(0.5, 100)]), 0.05, 0.02) == {"verdict": "no sellers", "book_ok": False}


def test_no_bids_mid_is_ask():
    r = check(0.8, book([(0.6, 100)]), 0.0, 0.02)
    assert r["best_bid"] is None and r["book_mid"] == 0.6 and r["spread"] == 0
    assert r["net_edge"] == pytest.approx(0.2) and r["verdict"] == "worth it"


def test_levels_sorted_regardless_of_input_order():
    r = check(0.8, book([(0.7, 10), (0.6, 10)], [(0.5, 10), (0.55, 10)]), 0.0, 0.02)
    assert r["best_ask"] == 0.6 and r["best_bid"] == 0.55


def test_thin_vs_not_worth_it():
    # gross = 0.65 - 0.55 = 0.10, net = 0.65 - 0.62 = 0.03 -> retention 0.3 < 0.5 -> thin
    assert check(0.65, book([(0.62, 100)], [(0.48, 100)]), 0.0, 0.02)["verdict"] == "thin"
    assert check(0.60, book([(0.62, 100)], [(0.48, 100)]), 0.0, 0.02)["verdict"] == "not worth it"


def test_fill_walks_book_and_stops_at_depth():
    asks = [(0.5, 10), (0.6, 10)]
    f = fill(asks, 8, 0.0)  # $5 at 0.5 (10 sh) + $3 at 0.6 (5 sh)
    assert f["shares"] == pytest.approx(15) and f["avg_price"] == pytest.approx(8 / 15)
    f = fill(asks, 1000, 0.0)  # book holds only $11
    assert f["shares"] == pytest.approx(20) and f["filled_usd"] == pytest.approx(11)


def test_fill_includes_fee_and_empty_book():
    f = fill([(0.5, 1000)], 10, 0.1)  # fee 0.025/share -> 0.525 per share
    assert f["shares"] == pytest.approx(10 / 0.525) and f["avg_fee"] == pytest.approx(0.025)
    assert fill([], 10, 0.0) is None


def test_capacity():
    asks = [(0.5, 10), (0.6, 10), (0.7, 10)]
    assert capacity(asks, 0.65, 0.0, 0.02) == pytest.approx(5 + 6)  # 0.7 level has edge < min
    assert capacity(asks, 0.5, 0.0, 0.02) == 0  # first level already fails
    assert capacity([], 0.9, 0.0, 0.02) == 0


# ---- model ----
def cfg(tmp_path, **kw):
    c = Config(prior_strength=40, min_node_neff=40, min_node_events=25, flag_confidence_z=1.28,
               output_dir=str(tmp_path), taker_slippage=0.005, flag_min_edge=0.02,
               price_min=0.05, price_max=0.95, settle_days=0,
               walk_forward={"test_days": 7, "folds": 3})
    c.update(kw)
    return c


def synthetic(n, ts, seed=0):
    rng = np.random.default_rng(seed)
    p = rng.uniform(0.03, 0.97, n)
    y = (rng.uniform(size=n) < p).astype(float)  # perfectly calibrated
    z = np.zeros(n, int)
    b = Bets(dict(p=p, y=y, h=np.full(n, 24), ts=ts, cat=z, niche=z, mt=z, ev=np.arange(n),
                  mid=np.arange(n), side=z), {"cat": ["sports"], "niche": ["nba"], "mt": ["moneyline"]})
    b.fee_rate = np.full(n, 0.05)
    return b


def test_fit_on_calibrated_data_recovers_identity(tmp_path):
    n = 200_000
    b = synthetic(n, np.zeros(n))
    m = Model(cfg(tmp_path, prior_strength=1e-6), b.vocab, None).fit(b, asof=0)
    th = m.nodes[("all", 24)]["theta"]
    assert np.allclose(th, PERFECT, atol=0.2), th
    ps = np.array([0.1, 0.3, 0.5, 0.7, 0.9])
    q = m.predict(ps, 24, 0, 0, 0)[0]
    assert np.allclose(q, ps, atol=0.015), q


# ---- backtest ----
def test_backtest_never_trains_on_fold_or_later(tmp_path, monkeypatch):
    seen = []

    class Spy(Model):
        def fit(self, b, asof):
            assert (b.ts < asof).all(), "train rows at/after fold start"
            seen.append(asof)
            return super().fit(b, asof)

    monkeypatch.setattr(backtest, "Model", Spy)
    n = 20_000
    ts = np.random.default_rng(1).uniform(0, 60 * DAY, n)
    backtest.run(cfg(tmp_path), synthetic(n, ts), half_lives=[None], log=lambda *a: None)
    assert len(seen) == 3


def test_fit_skips_horizon_with_too_few_bets(tmp_path):
    # early walk-forward folds (52 weekly) can hold a horizon with < 20 training bets
    n = 2000
    b = synthetic(n, np.zeros(n))
    b.h = np.where(np.arange(n) < 5, 1, 24)
    m = Model(cfg(tmp_path), b.vocab, None).fit(b, asof=0)
    assert ("all", 24) in m.nodes and ("all", 1) not in m.nodes
    assert m.predict(np.array([0.5]), 1, 0, 0, 0) is None
