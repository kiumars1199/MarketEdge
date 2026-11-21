"""T-296: optional backtest pricing at the real ask (config `taker_price`, default "mid").
"ask" charges the premium live asks paid over the history price at flag time (output/ask_premium.json) where a
niche|market type is calibrated, and keeps the half-spread charge elsewhere."""
import json

import numpy as np
import pytest

from engine import backtest
from engine.tests.test_engine import cfg, synthetic


def bets():
    b = synthetic(4, np.zeros(4))
    b.niche = np.array([0, 0, 1, 2])
    b.cat = np.array([0, 0, 0, 1])
    b.vocab = {"cat": ["sports", "weather"], "niche": ["nba", "nfl", "nyc"], "mt": ["moneyline"]}
    return b


def test_default_is_mid_half_spread(tmp_path):
    (tmp_path / "spreads.json").write_text(json.dumps({"nba|moneyline": {"median": 0.02}}))
    (tmp_path / "ask_premium.json").write_text(json.dumps({"all": {"median": 0.5}}))
    c = cfg(tmp_path)
    assert c.taker_price is None
    assert np.allclose(backtest.slippage(c, bets()), [0.01, 0.01, 0.005, 0.005])
    assert np.allclose(backtest.slippage(cfg(tmp_path, taker_price="mid"), bets()), [0.01, 0.01, 0.005, 0.005])


def test_ask_uses_calibrated_premium_else_half_spread_else_category(tmp_path):
    (tmp_path / "spreads.json").write_text(json.dumps({"nba|moneyline": {"median": 0.02}, "nfl|moneyline": {"median": 0.30}}))
    (tmp_path / "ask_premium.json").write_text(json.dumps({
        "nba|moneyline": {"median": 0.03, "n": 50}, "cat:sports": {"median": 0.02, "n": 80},
        "cat:weather": {"median": 0.012, "n": 80}, "all": {"median": 0.015, "n": 200}}))
    s = backtest.slippage(cfg(tmp_path, taker_price="ask"), bets())
    # nba: calibrated 3c (over its 1c half spread); nfl: not calibrated, keeps its 15c half spread;
    # nyc: in neither file, weather's premium
    assert np.allclose(s, [0.03, 0.03, 0.15, 0.012])


def test_ask_never_below_floor_and_needs_calibration(tmp_path):
    (tmp_path / "ask_premium.json").write_text(json.dumps({"all": {"median": -0.01}}))
    assert np.allclose(backtest.slippage(cfg(tmp_path, taker_price="ask"), bets()), 0.005)
    (tmp_path / "ask_premium.json").unlink()
    with pytest.raises(FileNotFoundError):
        backtest.slippage(cfg(tmp_path, taker_price="ask"), bets())
