"""`engine scan` keeps the scan it replaced as *-prev.json (Free tier delay, docs/15; AUDIT run 2 fail 1)."""
import json
import os

import pytest

from engine.__main__ import scan_keeping_prev


class Cfg:
    def __init__(self, d):
        self.d = d

    def path(self, kind, name):
        return os.path.join(self.d, name)


def write(d, at):
    for name, key in (("markets.json", "markets"), ("flags.json", "flags")):
        json.dump({"meta": {"scanned_at": at}, key: []}, open(os.path.join(d, name), "w"))


def at(d, name):
    return json.load(open(os.path.join(d, name)))["meta"]["scanned_at"]


def test_rotates_old_scan_to_prev(tmp_path):
    d = str(tmp_path)
    write(d, 100)
    scan_keeping_prev(Cfg(d), run=lambda cfg: write(d, 200))
    for name in ("markets", "flags"):
        assert at(d, f"{name}.json") == 200
        assert at(d, f"{name}-prev.json") == 100


def test_first_scan_writes_no_prev(tmp_path):
    d = str(tmp_path)
    scan_keeping_prev(Cfg(d), run=lambda cfg: write(d, 200))
    assert not os.path.exists(os.path.join(d, "markets-prev.json"))


def test_failed_scan_rotates_nothing(tmp_path):
    d = str(tmp_path)
    write(d, 100)

    def boom(cfg):
        raise RuntimeError("scan failed")

    with pytest.raises(RuntimeError):
        scan_keeping_prev(Cfg(d), run=boom)
    assert not os.path.exists(os.path.join(d, "flags-prev.json"))
    assert at(d, "flags.json") == 100


def test_keeps_two_older_scans(tmp_path):
    """RT3-03: at a 10-minute cadence the scan just replaced is only ~10 min old, so one copy can't hold a 15-min
    delay. The publisher keeps two (prev, prev2); the web store serves the newest that is old enough."""
    d = str(tmp_path)
    write(d, 100)
    for t in (200, 300):
        scan_keeping_prev(Cfg(d), run=lambda cfg, t=t: write(d, t))
    for name in ("markets", "flags"):
        assert at(d, f"{name}.json") == 300
        assert at(d, f"{name}-prev.json") == 200
        assert at(d, f"{name}-prev2.json") == 100
