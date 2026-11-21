"""Gamma rejects deep offsets with 422 "offset too large": closed_events splits the window instead of failing."""
from pipeline import fetch_closed


def test_offset_too_large_splits_window(monkeypatch):
    calls = []

    def fake_http(method, url, params):
        calls.append((params["offset"], params["end_date_min"], params["end_date_max"]))
        lo, hi = params["end_date_min"], params["end_date_max"]
        if (lo, hi) == (fetch_closed._iso(0), fetch_closed._iso(1000)):   # the full window is "busy"
            if params["offset"] >= 200:
                raise RuntimeError('422 events {"error":"offset too large, use /events/keyset"}')
            return [{"id": f"x{params['offset'] + i}"} for i in range(100)]
        return [{"id": f"{lo}-{hi}"}]                                      # each half is small

    monkeypatch.setattr(fetch_closed, "http", fake_http)
    out = fetch_closed.closed_events("sports", 0, 1000)
    assert sorted(e["id"] for e in out) == sorted([f"{fetch_closed._iso(500)}-{fetch_closed._iso(1000)}",
                                                  f"{fetch_closed._iso(0)}-{fetch_closed._iso(500)}"])


def test_other_errors_still_raise(monkeypatch):
    def boom(method, url, params):
        raise RuntimeError("500 server error")
    monkeypatch.setattr(fetch_closed, "http", boom)
    try:
        fetch_closed.closed_events("sports", 0, 1000)
    except RuntimeError as e:
        assert "500" in str(e)
    else:
        raise AssertionError("expected RuntimeError")
