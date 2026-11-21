"""Kalshi fetcher (pipeline/fetch_kalshi.py): flag gate, polite client, kalshi.json shape. No network."""
import json
import os

import pytest

from pipeline import fetch_kalshi as k

FIX = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "kalshi_api.json")))


class FakeClient:
    def __init__(self):
        self.calls = []

    def get(self, path, **params):
        self.calls.append((path, params))
        if path == "/events":
            return FIX["events"]
        if params.get("mve_filter") == "only":
            return FIX["combos"]
        return {"markets": [m for m in FIX["legs"]["markets"] if m["ticker"] in params["tickers"].split(",")]}


class Resp:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self.body, self.headers = status, body or {}, headers or {}

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class Session:
    def __init__(self, replies):
        self.replies, self.seen = list(replies), []

    def get(self, url, params=None, headers=None, timeout=None):
        self.seen.append((url, params, headers))
        return self.replies.pop(0)


def test_flag_off_makes_no_network_call(tmp_path, monkeypatch):
    monkeypatch.delenv("KALSHI_DATA_PERMISSION", raising=False)
    monkeypatch.setattr(k, "Client", lambda *a, **kw: pytest.fail("network client built with the flag off"))
    assert k.run_if_enabled(str(tmp_path / "kalshi.json"), str(tmp_path / "cache")) is None
    assert not (tmp_path / "kalshi.json").exists()
    monkeypatch.setenv("KALSHI_DATA_PERMISSION", "1")   # only the exact string "true" turns it on
    assert k.run_if_enabled(str(tmp_path / "kalshi.json"), str(tmp_path / "cache")) is None


def test_builds_markets_and_combos_from_fixtures(tmp_path):
    out = str(tmp_path / "kalshi.json")
    data = k.run(out, str(tmp_path / "cache"), client=FakeClient())
    assert json.load(open(out)) == data
    assert data["meta"]["source"] == "Kalshi"
    assert data["meta"]["complete"] and data["meta"]["n_events"] == 2 and data["meta"]["n_markets_open"] == 3
    mars = data["markets"][0]
    assert mars == {"ticker": "KXELONMARS-99", "event_ticker": "KXELONMARS-99", "series_ticker": "KXELONMARS",
                    "title": "Will Elon Musk visit Mars before Aug 1, 2099?", "subtitle": "Mars",
                    "yes_bid_cents": 10, "yes_ask_cents": 12, "no_bid_cents": None, "no_ask_cents": 90,
                    "last_price_cents": None, "volume": 127577, "volume_24h": None, "open_interest": None,
                    "status": None, "close_time": "2099-08-01T04:59:00Z",
                    "url": "https://kalshi.com/markets/kxelonmars", "source": "Kalshi"}
    lac = data["markets"][2]
    assert (lac["yes_bid_cents"], lac["yes_ask_cents"]) == (None, None)   # 0 / 100 = no quote
    assert all(m["source"] == "Kalshi" and m["url"].startswith("https://kalshi.com/") for m in data["markets"])

    combos = {c["ticker"]: c for c in data["combos"]}
    assert set(combos) == {"KXMVE-S1", "KXMVE-S2"}   # 7-leg combo and the unpriced one dropped
    s1 = combos["KXMVE-S1"]
    assert s1["price_basis"] == "legs_product" and s1["kalshi_yes_ask_cents"] is None
    assert [l["ask_cents"] for l in s1["legs"]] == [63, 30]   # yes ask; no ask from the leg's own quote
    assert s1["legs_product_cents"] == 18.9
    s2 = combos["KXMVE-S2"]
    assert s2["same_event"] and s2["legs_product_cents"] is None   # correlated legs: no product
    assert s2["price_basis"] == "kalshi_quote" and s2["kalshi_yes_ask_cents"] == 24


def test_only_missing_leg_tickers_are_requested(tmp_path):
    c = FakeClient()
    k.build(c)
    asked = [p["tickers"] for _, p in c.calls if "tickers" in p]
    assert asked == ["KXATPMATCH-26NOV17ZVEFIL-ZVE,KXX-1-A,KXY-1-B"]


def test_client_is_polite_retries_429_and_caches(tmp_path):
    slept = []
    clock = [1000.0]
    s = Session([Resp(429, headers={"Retry-After": "3"}), Resp(200, {"ok": 1})])
    c = k.Client(str(tmp_path), ttl=600, delay=1.0, session=s, sleep=slept.append, now=lambda: clock[0])
    assert c.get("/markets", limit=100) == {"ok": 1}
    assert s.seen[0][2]["User-Agent"] == "Kismet scanner"
    assert s.seen[0][1] == {"limit": 100}
    assert slept[0] == 3.0 and len(s.seen) == 2
    # second call within the TTL comes from disk: no request
    clock[0] = os.path.getmtime(os.path.join(str(tmp_path), os.listdir(str(tmp_path))[0])) + 10
    assert c.get("/markets", limit=100) == {"ok": 1} and len(s.seen) == 2


def test_client_gives_up_after_repeated_429(tmp_path):
    s = Session([Resp(429)] * k.TRIES)
    c = k.Client(str(tmp_path), session=s, sleep=lambda _: None)
    with pytest.raises(RuntimeError):
        c.get("/markets")
    assert len(s.seen) == k.TRIES


def test_failure_never_breaks_the_scan(tmp_path, monkeypatch):
    monkeypatch.setenv("KALSHI_DATA_PERMISSION", "true")
    monkeypatch.setattr(k, "build", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("down")))
    logs = []
    assert k.run_if_enabled(str(tmp_path / "kalshi.json"), str(tmp_path / "cache"), log=logs.append) is None
    assert logs == ["kalshi: skipped (down)"]


# --- QA-D (Nov 21): full crawl, time budget, stage isolation, honest fetched_at, settlements -------------------------

def ev(i, n=1, **extra):
    """An open event with n markets, Kalshi's fixed-point encoding."""
    return {"event_ticker": f"KXE-{i}", "series_ticker": "KXE", "title": f"Event {i}",
            "markets": [{"ticker": f"KXE-{i}-{j}", "event_ticker": f"KXE-{i}", "yes_sub_title": f"m{j}",
                         "yes_bid_dollars": "0.4000", "yes_ask_dollars": "0.4200", "volume_fp": str(100 * i + j),
                         "close_time": "2099-01-01T00:00:00Z", **extra} for j in range(n)]}


class PagedClient:
    """/events in pages keyed by cursor; combos and tickers from `rest`."""

    def __init__(self, pages, combos=None, tickers=None, fail=None):
        self.pages, self.combos, self.tickers, self.fail = pages, combos, tickers or {}, fail or {}
        self.calls = []

    def get(self, path, **params):
        self.calls.append((path, params))
        if path == "/events":
            cur = params.get("cursor", "")
            if cur in self.fail:
                raise self.fail[cur]
            return self.pages[cur]
        if params.get("mve_filter") == "only":
            if isinstance(self.combos, Exception):
                raise self.combos
            return self.combos or {"markets": []}
        asked = params["tickers"].split(",")
        if isinstance(self.tickers, Exception):
            raise self.tickers
        return {"markets": [self.tickers[t] for t in asked if t in self.tickers]}


def test_crawl_follows_the_cursor_to_the_end_with_the_proven_query():
    c = PagedClient({"": {"cursor": "c1", "events": [ev(1, 2)]}, "c1": {"cursor": "c2", "events": [ev(2)]},
                     "c2": {"cursor": "", "events": [ev(3, 3)]}})
    data = k.build(c)
    assert data["meta"]["complete"] and data["meta"]["pages"] == 3 and data["meta"]["n_events"] == 3
    assert data["meta"]["n_markets_open"] == 6 and data["meta"]["notes"] == []
    assert [m["ticker"] for m in data["markets"][:2]] == ["KXE-3-2", "KXE-3-1"]   # by volume
    first = [p for path, p in c.calls if path == "/events"][0]
    assert first == {"status": "open", "with_nested_markets": "true", "limit": 100}   # unchanged query


def test_crawl_stops_on_a_repeated_cursor_and_keeps_what_it_has():
    c = PagedClient({"": {"cursor": "c1", "events": [ev(1)]}, "c1": {"cursor": "c1", "events": [ev(2)]}})
    data = k.build(c)
    assert not data["meta"]["complete"] and data["meta"]["n_markets_open"] == 2
    assert "repeated cursor" in data["meta"]["notes"][0]


def test_a_failed_later_page_keeps_the_earlier_pages_but_a_failed_first_page_raises():
    c = PagedClient({"": {"cursor": "c1", "events": [ev(1)]}}, fail={"c1": RuntimeError("502")})
    data = k.build(c)
    assert data["meta"]["n_markets_open"] == 1 and not data["meta"]["complete"]
    with pytest.raises(RuntimeError):
        k.build(PagedClient({}, fail={"": RuntimeError("down")}))


def test_combo_and_settlement_failures_still_write_the_markets(tmp_path):
    c = PagedClient({"": {"cursor": "", "events": [ev(1)]}}, combos=RuntimeError("combos 500"), tickers=RuntimeError("x"))
    known = tmp_path / "kalshi_known.json"
    known.write_text(json.dumps({"OLD-1": {"event_ticker": "OLD", "title": "Old", "close_time": "2020-01-01T00:00:00Z"}}))
    out = str(tmp_path / "kalshi.json")
    data = k.run(out, str(tmp_path / "cache"), client=c)
    assert json.load(open(out))["markets"][0]["ticker"] == "KXE-1-0"
    assert data["combos"] == [] and data["settled"] == []
    assert any("combos skipped" in n for n in data["meta"]["notes"])
    assert any("settlements skipped" in n for n in data["meta"]["notes"])


def test_the_time_budget_is_a_hard_wall_clock_deadline(tmp_path):
    clock = [1000.0]
    pages = {None: {"cursor": "c1", "events": [ev(1)]}, "c1": {"cursor": "c2", "events": [ev(2)]}}

    class S:
        def get(self, url, params=None, headers=None, timeout=None):
            if timeout < 20:   # every call takes 20 s; a shorter timeout cuts it off, as requests would
                clock[0] += timeout
                raise TimeoutError("read timed out")
            clock[0] += 20
            return Resp(200, pages.get(params.get("cursor"), {"cursor": "", "events": []}))

    c = k.Client(str(tmp_path / "cache"), session=S(), sleep=lambda s: clock.__setitem__(0, clock[0] + s),
                 now=lambda: clock[0])
    data = k.build(c, now=1000.0, budget=30)   # crawl share 21 s: one page, then out of time
    assert data["meta"]["pages"] == 1 and not data["meta"]["complete"]
    assert any("Deadline" in n for n in data["meta"]["notes"])
    assert any("combos skipped: Deadline" in n for n in data["meta"]["notes"])


def test_backoff_never_sleeps_past_the_deadline(tmp_path):
    clock = [0.0]
    s = Session([Resp(429, headers={"Retry-After": "30"})])
    c = k.Client(str(tmp_path), session=s, sleep=lambda x: pytest.fail("slept past the deadline"), now=lambda: clock[0])
    c.deadline = 10.0
    with pytest.raises(k.Deadline):
        c.get("/events")


def test_fetched_at_is_the_oldest_page_used_and_the_cache_is_shorter_than_the_scan(tmp_path):
    assert k.TTL_S < 120
    clock = [5000.0]
    s = Session([Resp(200, {"a": 1}), Resp(200, {"b": 1})])
    c = k.Client(str(tmp_path), session=s, sleep=lambda _: None, now=lambda: clock[0])
    c.get("/x")
    path = os.path.join(str(tmp_path), os.listdir(str(tmp_path))[0])
    os.utime(path, (4950, 4950))   # that page was cached 50 s ago
    c.get("/x")                    # cache hit
    clock[0] = 5010.0
    c.get("/y")                    # fresh
    assert c.oldest == 4950


def test_prune_deletes_only_old_cache_files(tmp_path):
    clock = [10 ** 6]
    c = k.Client(str(tmp_path), now=lambda: clock[0])
    old, new, other = tmp_path / ("a" * 40 + ".json"), tmp_path / ("b" * 40 + ".json"), tmp_path / "keep.json"
    for p in (old, new, other):
        p.write_text("{}")
    os.utime(old, (0, 0))
    os.utime(other, (0, 0))
    assert c.prune() == 1
    assert not old.exists() and new.exists() and other.exists()


def test_new_fields_read_both_encodings_and_stay_null_when_absent():
    m = {"ticker": "T", "no_bid_dollars": "0.3300", "last_price": 41, "volume_24h_fp": "12.9", "open_interest": 7,
         "status": "active"}
    r = k.market_row(m, "E", "S")
    assert (r["no_bid_cents"], r["last_price_cents"], r["volume_24h"], r["open_interest"], r["status"]) == (33, 41, 12, 7, "active")
    r = k.market_row({"ticker": "T"}, "E", "S")
    assert (r["no_bid_cents"], r["last_price_cents"], r["volume_24h"], r["open_interest"], r["status"], r["volume"]) == \
        (None, None, None, None, None, 0)


def test_kalshi_json_stays_bounded(monkeypatch):
    monkeypatch.setattr(k, "KEEP_MARKETS", 2)
    data = k.build(PagedClient({"": {"cursor": "", "events": [ev(1, 3), ev(2, 2)]}}))
    assert len(data["markets"]) == 2 and data["meta"]["n_markets"] == 2 and data["meta"]["n_markets_open"] == 5


def test_settlements_from_result_with_history_and_carry_over(tmp_path):
    now = 1_795_219_200   # 2026-11-21
    known = tmp_path / "kalshi_known.json"
    known.write_text(json.dumps({
        "KXG-1-A": {"event_ticker": "KXG-1", "series_ticker": "KXG", "title": "Game 1", "subtitle": "A",
                    "close_time": "2026-11-20T03:00:00Z"},
        "KXG-2-A": {"event_ticker": "KXG-2", "series_ticker": "KXG", "title": "Game 2", "subtitle": "A",
                    "close_time": "2026-11-20T03:00:00Z"},   # closed, no result yet: asked again next run
        "KXG-3-A": {"event_ticker": "KXG-3", "title": "Ancient", "close_time": "2026-09-01T00:00:00Z"},   # given up
    }))
    tickers = {"KXG-1-A": {"ticker": "KXG-1-A", "status": "finalized", "result": "no"},
               "KXG-2-A": {"ticker": "KXG-2-A", "status": "closed", "result": ""}}
    c = PagedClient({"": {"cursor": "", "events": [ev(1)]}}, tickers=tickers)
    out = tmp_path / "kalshi.json"
    out.write_text(json.dumps({"settled": [
        {"ticker": "KXOLD-1", "result": "yes", "settled_seen_at": now - 86_400},       # kept (1 day)
        {"ticker": "KXOLD-2", "result": "yes", "settled_seen_at": now - 8 * 86_400}]}))  # dropped (8 days)
    data = k.run(str(out), str(tmp_path / "cache"), client=c, now=now)
    assert [(s["ticker"], s["result"]) for s in data["settled"]] == [("KXG-1-A", "no"), ("KXOLD-1", "yes")]
    s = data["settled"][0]
    assert s["status"] == "finalized" and s["title"] == "Game 1" and s["url"] == "https://kalshi.com/markets/kxg"
    left = json.loads(known.read_text())
    assert "KXG-1-A" not in left and "KXG-2-A" in left and "KXG-3-A" not in left and "KXE-1-0" in left
    hist = [json.loads(line) for line in (tmp_path / "kalshi_settled.jsonl").read_text().splitlines()]
    assert [h["ticker"] for h in hist] == ["KXG-1-A"]
    dump = json.loads((tmp_path / "kalshi_markets.json").read_text())
    assert dump["complete"] and [m["ticker"] for m in dump["markets"]] == ["KXE-1-0"]
    asked = [p["tickers"] for path, p in c.calls if "tickers" in p]
    assert asked == ["KXG-3-A,KXG-1-A,KXG-2-A"]   # oldest close first, open tickers never asked


def test_an_unresolved_backlog_does_not_starve_newer_tickers(monkeypatch):
    monkeypatch.setattr(k, "SETTLE_PER_RUN", 2)
    monkeypatch.setattr(k, "TICKER_BATCH", 2)
    now = 1_795_219_200
    known = {f"KXB-{i}": {"event_ticker": "KXB", "title": "B", "close_time": f"2026-11-1{i}T00:00:00Z"} for i in range(4)}
    asked = []

    class C:
        deadline = None

        def get(self, path, **p):
            asked.append(p["tickers"])
            return {"markets": []}   # nothing has a result yet

    k.settle(C(), known, set(), now)
    k.settle(C(), known, set(), now + 120)
    assert asked == ["KXB-0,KXB-1", "KXB-2,KXB-3"]   # the second run asks the two not asked yet


def test_a_partial_crawl_keeps_a_recent_complete_crawl():
    t0 = 1_795_219_200
    full = k.build(PagedClient({"": {"cursor": "", "events": [ev(1, 5), ev(2, 5)]}}), now=t0)
    assert full["meta"]["complete"] and full["meta"]["complete_at"] == t0
    part = k.build(PagedClient({"": {"cursor": "c1", "events": [ev(3, 1)]}}, fail={"c1": RuntimeError("502")}),
                   prev=full, now=t0 + 120)
    assert not part["meta"]["complete"] and part["meta"]["n_markets_open"] == 1 and len(part["markets"]) == 11
    assert part["meta"]["complete_at"] == t0 and any("kept 10 markets" in n for n in part["meta"]["notes"])
    # after 30 minutes without a complete crawl, a partial one publishes as it is
    late = k.build(PagedClient({"": {"cursor": "c1", "events": [ev(3, 1)]}}, fail={"c1": RuntimeError("502")}),
                   prev=part, now=t0 + 1900)
    assert len(late["markets"]) == 1 and not any("kept" in n for n in late["meta"]["notes"])
