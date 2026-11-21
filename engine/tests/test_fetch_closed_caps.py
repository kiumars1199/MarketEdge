"""T-278: more closed-market history. fetch_closed caps above Gamma's offset limit work (the busy window is split,
never paged deeper), 0 means no cap, rows stream to disk page by page, and a backfill rerun with a higher cap tops
up windows an earlier, smaller run marked done."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "pipeline"))
import fetch_closed  # noqa: E402

DAY = 86400
NOW = 100 * DAY


def event(e):
    iso = fetch_closed._iso(e)
    return {"id": f"e{int(e)}", "title": "E", "slug": "e", "tags": [{"slug": "nba"}], "markets": [{
        "id": f"m{int(e)}", "outcomePrices": '["1", "0"]', "clobTokenIds": '["a", "b"]', "outcomes": '["Y", "N"]',
        "endDate": iso, "startDate": "1970-01-02T00:00:00Z"}]}


def gamma(ends, cap=2000, fail_at=None):
    """Fake Gamma /events: closed events with end dates `ends`, newest first; offsets past `cap` are refused
    with 422 like the real API. `fail_at`: the call number that raises a 500 (to test resume)."""
    calls = []
    from pipeline.common import parse_ts

    def http(method, url, params=None, **kw):
        calls.append(dict(params))
        if fail_at is not None and len(calls) == fail_at:
            raise RuntimeError("500 server error")
        if params["offset"] > cap:
            raise RuntimeError('422 events {"error":"offset too large, use /events/keyset"}')
        lo, hi = parse_ts(params["end_date_min"]), parse_ts(params["end_date_max"])
        evs = sorted((e for e in ends if lo <= e <= hi), reverse=True)
        return [event(e) for e in evs[params["offset"]:params["offset"] + params["limit"]]]
    return http, calls


def ids(path):
    return [json.loads(line)["id"] for line in open(path)]


def test_iter_closed_events_streams_past_the_offset_cap(monkeypatch):
    ends = [NOW - i * 60 for i in range(5000)]
    http, calls = gamma(ends)
    monkeypatch.setattr(fetch_closed, "http", http)
    got = [e["id"] for e in fetch_closed.iter_closed_events("nba", NOW - 10 * DAY, NOW)]
    assert len(got) == len(set(got)) == 5000          # every event once, none lost to the cap
    assert max(c["offset"] for c in calls) <= 2000


def test_iter_closed_events_limit_keeps_newest(monkeypatch):
    ends = [NOW - i * 60 for i in range(5000)]
    monkeypatch.setattr(fetch_closed, "http", gamma(ends)[0])
    got = [e["id"] for e in fetch_closed.iter_closed_events("nba", NOW - 10 * DAY, NOW, limit=250)]
    assert got == [f"e{int(e)}" for e in ends[:250]]


def test_default_mode_per_tag_above_offset_cap(tmp_path, monkeypatch):
    """docs/19 P5's `--days 730 --per-tag 4000` crashed on 422 offset too large; now it gets 4000 events per tag."""
    ends = [NOW - i * 600 for i in range(6000)]
    monkeypatch.setattr(fetch_closed, "http", gamma(ends)[0])
    monkeypatch.setattr(fetch_closed, "SAMPLE_TAGS", ["nba"])
    out = str(tmp_path / "markets.jsonl")
    n = fetch_closed.sample(730, 4000, "endDate", out=out, now=NOW, log=lambda *a: None)
    got = ids(out)
    assert n == len(got) == len(set(got)) == 4000
    assert got[0] == f"m{NOW}"                          # newest first


def test_default_mode_per_tag_zero_means_all(tmp_path, monkeypatch):
    ends = [NOW - i * 600 for i in range(3000)] + [NOW - 800 * DAY]   # the last one is outside --days
    monkeypatch.setattr(fetch_closed, "http", gamma(ends)[0])
    monkeypatch.setattr(fetch_closed, "SAMPLE_TAGS", ["nba"])
    out = str(tmp_path / "markets.jsonl")
    assert fetch_closed.sample(730, 0, "endDate", out=out, now=NOW, log=lambda *a: None) == 3000


def test_backfill_per_window_above_offset_cap_and_zero(tmp_path, monkeypatch):
    ends = [NOW - i * 120 for i in range(4500)]     # ~6 days, all in the newest 7-day window
    monkeypatch.setattr(fetch_closed, "http", gamma(ends)[0])
    monkeypatch.setattr(fetch_closed, "SAMPLE_TAGS", ["nba"])
    out, st = str(tmp_path / "m.jsonl"), str(tmp_path / "s.json")
    json.dump({"anchor": NOW}, open(st, "w"))
    fetch_closed.backfill(14, 7, 3000, "endDate", out=out, state_p=st, log=lambda *a: None)
    assert len(set(ids(out))) == len(ids(out)) == 3000
    fetch_closed.backfill(14, 7, 0, "endDate", out=out, state_p=st, log=lambda *a: None)   # 0 = no cap
    assert len(set(ids(out))) == len(ids(out)) == 4500


def test_backfill_higher_cap_tops_up_windows_done_at_a_lower_cap(tmp_path, monkeypatch):
    """The Actions cache holds windows marked done by `--per-window 200` (no cap in the old key). A rerun with a
    bigger cap must fetch them again (deduped), not skip them; a rerun with the same or smaller cap skips them."""
    ends = [NOW - i * 600 for i in range(900)]
    http, calls = gamma(ends)
    monkeypatch.setattr(fetch_closed, "http", http)
    monkeypatch.setattr(fetch_closed, "SAMPLE_TAGS", ["nba"])
    out, st = str(tmp_path / "m.jsonl"), str(tmp_path / "s.json")
    lo = NOW - 7 * DAY
    json.dump({"anchor": NOW, "done": [f"{int(lo)}|nba", f"{int(lo - 7 * DAY)}|nba"]}, open(st, "w"))  # legacy state
    fetch_closed.backfill(14, 7, 200, "endDate", out=out, state_p=st, log=lambda *a: None)
    assert calls == [] and not os.path.exists(out)    # legacy windows count as done at 200
    fetch_closed.backfill(14, 7, 600, "endDate", out=out, state_p=st, log=lambda *a: None)
    assert len(set(ids(out))) == len(ids(out)) == 600
    n_calls = len(calls)
    fetch_closed.backfill(14, 7, 600, "endDate", out=out, state_p=st, log=lambda *a: None)
    assert len(calls) == n_calls                       # done at 600 now: nothing refetched


def test_backfill_writes_each_page_before_the_window_finishes(tmp_path, monkeypatch):
    """Rows reach disk page by page (no window-sized list in memory); a crash mid-window keeps them, the window is
    not marked done, and the rerun finishes it without duplicates."""
    ends = [NOW - i * 600 for i in range(350)]
    http, _ = gamma(ends, fail_at=3)
    monkeypatch.setattr(fetch_closed, "http", http)
    monkeypatch.setattr(fetch_closed, "SAMPLE_TAGS", ["nba"])
    out, st = str(tmp_path / "m.jsonl"), str(tmp_path / "s.json")
    json.dump({"anchor": NOW}, open(st, "w"))
    try:
        fetch_closed.backfill(7, 7, 0, "endDate", out=out, state_p=st, log=lambda *a: None)
    except RuntimeError:
        pass
    assert len(ids(out)) == 200 and not json.load(open(st)).get("done")
    monkeypatch.setattr(fetch_closed, "http", gamma(ends)[0])
    fetch_closed.backfill(7, 7, 0, "endDate", out=out, state_p=st, log=lambda *a: None)
    assert len(set(ids(out))) == len(ids(out)) == 350


def test_backfill_resumes_after_a_kill_mid_row(tmp_path, monkeypatch):
    """A kill (OOM, timeout) can leave markets.jsonl ending in half a row. The rerun drops the partial row (cut inside
    the id or after it) instead of crashing on it or gluing the next row onto it, and refetches that market."""
    ends = [NOW - i * 600 for i in range(150)]
    monkeypatch.setattr(fetch_closed, "SAMPLE_TAGS", ["nba"])
    for cut in ('{"id": "m12', '{"id": "m123", "question": "Q'):
        out, st = str(tmp_path / f"m{len(cut)}.jsonl"), str(tmp_path / f"s{len(cut)}.json")
        monkeypatch.setattr(fetch_closed, "http", gamma(ends[:50])[0])
        json.dump({"anchor": NOW}, open(st, "w"))
        fetch_closed.backfill(7, 7, 50, "endDate", out=out, state_p=st, log=lambda *a: None)
        with open(out, "a") as f:
            f.write(cut)                                # killed while writing the next row
        monkeypatch.setattr(fetch_closed, "http", gamma(ends)[0])
        fetch_closed.backfill(7, 7, 0, "endDate", out=out, state_p=st, log=lambda *a: None)
        got = ids(out)
        assert len(got) == len(set(got)) == 150
