"""T-295: top.json / counts.json / top-<category>.json after each scan (engine/precompute.py)."""
import json
import os

from engine import precompute
from engine.__main__ import scan_keeping_prev


def flag(i, *, tier="best", verdict="worth it", win=0.6, roi=10.0, closes=2000, cat="sports"):
    best = {"side_index": 0, "win_prob": win, "roi_pct": roi, "edge": 0.05}
    return {"id": str(i), "category": cat, "tier": tier, "closes_at": closes, "best": best,
            "sides": [best], "execution": {"verdict": verdict}}


def flags_file(rows, at=1000):
    return {"meta": {"scanned_at": at, "markets_scanned": 99}, "flags": rows}


def test_list_matches_the_best_bets_rule_and_page_order():
    rows = [flag(1, roi=5), flag(2, roi=20), flag(3, tier="edge"), flag(4, verdict="not worth it"),
            flag(5, win=0.39), flag(6, closes=1000), flag(7, roi=20, closes=1500), flag(8, verdict="thin", cat="weather")]
    top = precompute.top_rows(flags_file(rows))
    assert [r["market"]["id"] for r in top] == ["7", "2", "8", "1"]   # roi desc, then closes soonest
    assert all(r["side"] is r["market"]["best"] for r in top)


def test_counts():
    ff = flags_file([flag(1), flag(2, verdict="thin", cat="weather"), flag(3, tier="edge")])
    c = precompute.counts(ff, precompute.top_rows(ff))
    assert c["best_bets"] == {"total": 2, "sections": {"worth it": 1, "thin": 1}, "by_category": {"sports": 1, "weather": 1}}
    assert c["tiers"] == {"best": 2, "edge": 1} and c["markets_scanned"] == 99 and c["scanned_at"] == 1000


def test_write_files_and_per_category(tmp_path):
    d = str(tmp_path)
    json.dump(flags_file([flag(1), flag(2, cat="weather")]), open(os.path.join(d, "flags.json"), "w"))
    assert precompute.write(d, log=lambda *_: None)
    top = json.load(open(os.path.join(d, "top.json")))
    assert top["total"] == 2 and top["meta"]["scanned_at"] == 1000
    assert json.load(open(os.path.join(d, "top-weather.json")))["total"] == 1
    assert not os.path.exists(os.path.join(d, "top-crypto.json"))
    assert json.load(open(os.path.join(d, "counts.json")))["best_bets"]["total"] == 2


def test_failure_removes_stale_files(tmp_path):
    d = str(tmp_path)
    for n in ("top.json", "counts.json", "top-sports.json"):
        open(os.path.join(d, n), "w").write("{}")
    open(os.path.join(d, "flags.json"), "w").write("not json")
    assert not precompute.write(d, log=lambda *_: None)
    assert not [n for n in os.listdir(d) if n.startswith(("top", "counts"))]


class Cfg:
    def __init__(self, d):
        self.d = d

    def path(self, kind, name):
        return os.path.join(self.d, name)


def test_scan_rotates_top_and_counts(tmp_path):
    d = str(tmp_path)

    def scan(at):
        def run(cfg):
            json.dump(flags_file([flag(1)], at), open(os.path.join(d, "flags.json"), "w"))
            json.dump({"meta": {"scanned_at": at}, "markets": []}, open(os.path.join(d, "markets.json"), "w"))
        return run

    for at in (100, 200, 300):
        scan_keeping_prev(Cfg(d), run=scan(at))
    at = lambda n: json.load(open(os.path.join(d, n)))["meta"]["scanned_at"]  # noqa: E731
    assert (at("top.json"), at("top-prev.json"), at("top-prev2.json")) == (300, 200, 100)
    assert json.load(open(os.path.join(d, "counts-prev.json")))["scanned_at"] == 200


def test_counts_use_the_us_set_when_the_scan_priced_us():
    """§G2: with meta.us.ok the one Best bets count is the "On Polymarket US" set; top.json stays the full list."""
    from engine import precompute
    base = dict(tier="best", execution=dict(verdict="worth it"), closes_at=200, category="sports")
    flags = [dict(base, id="a", best=dict(win_prob=0.8, roi_pct=5), us=dict(ask=0.7, edge=0.05, roi_pct=9)),
             dict(base, id="b", best=dict(win_prob=0.8, roi_pct=8), us=dict(ask=0.7, edge=0.01, roi_pct=1)),
             dict(base, id="c", best=dict(win_prob=0.8, roi_pct=7), us=None)]
    ff = dict(meta=dict(scanned_at=100, rule=dict(min_edge=0.02), us=dict(ok=True)), flags=flags)
    rows = precompute.top_rows(ff)
    assert [r["market"]["id"] for r in rows] == ["a", "c", "b"]   # US return ranks US rows (a 9 > c 7 > b 1)
    assert precompute.counts(ff, rows)["best_bets"]["total"] == 1
    ff["meta"]["us"]["ok"] = False
    rows = precompute.top_rows(ff)
    assert [r["market"]["id"] for r in rows] == ["b", "c", "a"]
    assert precompute.counts(ff, rows)["best_bets"]["total"] == 3
