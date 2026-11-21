"""At most `max_best_per_event` Best bets per game (docs/OVERHAUL.md §G5): scan, ledger-aware, and backtest."""
import json
import os

import numpy as np

from engine import backtest, ledger, scan
from engine.config import Config

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def fl(mid, ev, net, verdict="worth it", side=0):
    return dict(id=mid, event_id=ev, best=dict(side_index=side),
                execution=dict(verdict=verdict, net_edge=net))


def test_keeps_the_two_best_lines_per_game_in_scan_order():
    flags = [fl("a1", "A", 0.03), fl("a2", "A", 0.08, "thin"), fl("a3", "A", 0.05), fl("a4", "A", 0.04),
             fl("b1", "B", 0.02), fl("c1", None, 0.02), fl("c2", None, 0.02)]
    kept, out = scan.cap_per_event(flags, 2)
    # "worth it" outranks "thin" even at a lower net edge, as in flags.json order; order of `flags` preserved
    assert [r["id"] for r in kept] == ["a3", "a4", "b1", "c1", "c2"]
    assert [r["id"] for r in out] == ["a1", "a2"]


def test_no_cap_when_unset_or_zero():
    flags = [fl(str(i), "A", 0.05) for i in range(5)]
    assert len(scan.cap_per_event(flags, None)[0]) == 5 and len(scan.cap_per_event(flags, 0)[0]) == 5


def test_lines_already_in_the_record_keep_their_slots():
    # the ledger holds a1 for game A, so only one new A line fits; a1 itself (re-flag at a better ask) stays
    flags = [fl("a1", "A", 0.01), fl("a2", "A", 0.09), fl("a3", "A", 0.07)]
    kept, out = scan.cap_per_event(flags, 2, held={"A": {("a1", 0)}})
    assert [r["id"] for r in kept] == ["a1", "a2"] and [r["id"] for r in out] == ["a3"]
    # game full in the record: new lines are capped, so the record never grows past 2 per game
    kept, _ = scan.cap_per_event([fl("a4", "A", 0.2)], 2, held={"A": {("a1", 0), ("a2", 0)}})
    assert kept == []


def test_held_by_event_reads_the_ledger(tmp_path):
    cfg = Config(output_dir=str(tmp_path))
    with open(cfg.path("output", "ledger.jsonl"), "w") as f:
        for e in (dict(id="1", side_index=0, event_id="A"), dict(id="2", side_index=1, event_id="A"),
                  dict(id="3", side_index=0)):  # rows from before event_id was logged don't hold slots
            f.write(json.dumps(e) + "\n")
    assert ledger.held_by_event(cfg) == {"A": {("1", 0), ("2", 1)}}
    assert ledger.held_by_event(Config(output_dir=str(tmp_path / "empty"))) == {}


def test_backtest_cap_per_event_and_horizon():
    ev = np.array([1, 1, 1, 1, 2, 1, 1])
    h = np.array([24, 24, 24, 24, 24, 6, 6])
    score = np.array([0.03, 0.09, 0.05, 0.20, 0.04, 0.01, 0.02])
    mask = np.array([True, True, True, False, True, True, True])
    out = backtest.cap_mask(mask, ev, h, score, 2)
    # event 1 @24h: 0.09 and 0.05 (0.20 isn't a flag); event 2: its one flag; event 1 @6h: both
    assert out.tolist() == [False, True, True, False, True, True, True]
    assert backtest.cap_mask(mask, ev, h, score, None).tolist() == mask.tolist()
    assert backtest.cap_mask(mask, ev, h, score, 1).sum() == 3


def test_config_default_is_two():
    cfg = json.load(open(os.path.join(ROOT, "config", "demo.json")))
    assert cfg["max_best_per_event"] == 2 and cfg["us_native_scan"] is False
