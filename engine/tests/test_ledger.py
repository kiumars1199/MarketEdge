"""Flag ledger: append dedupe and the grader, offline on a fixture."""
import json
import os

import pytest

from engine import ledger
from engine.config import Config
from pipeline.common import jl_read, jl_write

FIX = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "ledger_case.json")))


def test_grade_fixture(tmp_path):
    cfg = Config(output_dir=str(tmp_path))
    jl_write(cfg.path("output", "ledger.jsonl"), FIX["ledger"])
    s = ledger.grade(cfg, get_market=FIX["markets"].__getitem__,
                     get_history=lambda t: FIX["history"].get(t, []), now=50000, log=lambda *a: None)
    rows = {e["id"]: e for e in jl_read(cfg.path("output", "ledger.jsonl"))}
    for mid, exp in FIX["expected"].items():
        if exp is None:
            assert "result" not in rows[mid]
            continue
        for k, v in exp.items():
            assert rows[mid][k] == (pytest.approx(v) if isinstance(v, float) else v), (mid, k)
    for k, v in FIX["summary"].items():
        assert s[k] == pytest.approx(v), k
    assert s["by_category"]["weather"]["entries"] == 2
    assert json.load(open(cfg.path("output", "ledger_summary.json")))["graded"] == 3
    # graded rows are not re-graded
    ledger.grade(cfg, get_market=lambda m: pytest.fail("re-fetched graded market") if m != "4"
                 else FIX["markets"]["4"], get_history=lambda t: [], now=60000, log=lambda *a: None)


def flag(ask, side=0):
    return dict(id="9", question="q", category="sports", niche="nba", tokens=["a", "b"], closes_at=1,
                best=dict(side_index=side, outcome="Yes", ask=ask, fee=0.01, win_prob=0.6, edge=0.05),
                execution=dict(verdict="worth it"))


def test_append_dedupes_and_records_better_ask(tmp_path):
    cfg = Config(output_dir=str(tmp_path))
    assert ledger.append(cfg, [flag(0.50)], now=1) == 1
    assert ledger.append(cfg, [flag(0.50), flag(0.52)], now=2) == 0   # same or worse ask
    assert ledger.append(cfg, [flag(0.48)], now=3) == 1               # better ask
    assert ledger.append(cfg, [flag(0.60, side=1)], now=4) == 1       # other side
    rows = jl_read(cfg.path("output", "ledger.jsonl"))
    assert [r["ask"] for r in rows] == [0.50, 0.48, 0.60] and rows[2]["token"] == "b"
