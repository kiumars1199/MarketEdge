"""US-native scan (docs/OVERHAUL.md §G4) on a Polymarket US fixture, offline. Fixture = real gateway rows
(Nov 20, 2026, trimmed): fixtures/us_native_markets.json."""
import copy
import json
import os

import numpy as np
import pytest

from engine import ledger, scan, us_native
from engine.config import Config
from pipeline import venue_us as v
from pipeline.common import jl_read, parse_ts

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "us_native_markets.json")
NOW = parse_ts("2026-11-20T18:00:00Z")


def raw():
    return copy.deepcopy(json.load(open(FIX))["markets"])


def EV():
    """venue_us.fetch_events on the fixture's real event records (+ the synthetic twin's), one category page each."""
    evs = copy.deepcopy(json.load(open(FIX))["events"])
    btc = next(e for e in evs if e["slug"] == "btc-hit-h-w-2026-11-20")
    evs.append(dict(btc, id="9999", slug="twin-event", markets=[dict(slug="cpc-twin")]))
    asked = []

    def get(method, url, params=None, **kw):
        asked.append(params["categories"])
        return dict(events=[e for e in evs if e["category"] == params["categories"]] if params["offset"] == 0
                    else [])
    out = v.fetch_events(sorted(us_native.CATEGORY), get=get, log=lambda *a: None)
    assert sorted(asked) == sorted(us_native.CATEGORY)
    return out


def fetch(markets):
    return v.fetch_open(get=lambda method, url, params=None, **kw: dict(markets=markets if params["offset"] == 0
                                                                        else []), log=lambda *a: None)


class StubModel:
    """Model stand-in: the long side (side 0) is 6 points better than its mid, the short side 6 worse."""
    vocab = dict(cat=["sports", "crypto", "politics", "finance", "culture", "tech"],
                 niche=["bitcoin", "crypto", "politics", "finance", "culture", "tech", "fed"],
                 mt=["moneyline", "yes/no"])

    def __init__(self):
        self.calls = []

    def predict(self, p, h, cat, niche, mt):
        self.calls.append((p, h, cat, niche, mt))
        q = min(0.99, p + 0.06) if p < 0.5 else max(0.01, p - 0.06)
        return np.array([q]), np.array([q - 0.01]), ("nmt", h, cat, niche, mt), dict(neff=120.0, events=40)


def test_fetch_puts_the_long_side_first():
    us = fetch(raw())
    # "US Confirms That Aliens Exist" lists ["No","Yes"]; its bid/ask (2c/3c) are the long side, "Yes"
    assert us["usgcc-aliens-12-31-2026"]["outcomes"] == ["Yes", "No"]
    assert us["cpc-btc-hit-h-w-2026-11-20-80000"]["outcomes"] == ["Yes", "No"]
    m = us["cpc-btc-hit-h-w-2026-11-20-80000"]
    assert m["id"] and m["title"]  # carried for the row id and question
    assert m["start"] == "2026-11-13T22:00:00Z" and m["end"] == "2026-11-20T22:30:00Z"


def test_enabled_env_wins_over_config(monkeypatch):
    monkeypatch.delenv("US_NATIVE_SCAN", raising=False)
    assert us_native.enabled(Config()) is False
    assert us_native.enabled(Config(us_native_scan=True)) is True
    monkeypatch.setenv("US_NATIVE_SCAN", "1")
    assert us_native.enabled(Config()) is True
    monkeypatch.setenv("US_NATIVE_SCAN", "false")
    assert us_native.enabled(Config(us_native_scan=True)) is False


def native_fixture():
    ms = raw()
    tech = next(m for m in ms if m["category"] == "technology")
    # in the window (72 h), at a price the flag rule accepts (31c mid: the stub model says 37%)
    tech.update(endDate="2026-11-23T18:00:00Z", gameStartTime="2026-11-01T00:00:00Z",
                bestBidQuote={"value": "0.30"}, bestAskQuote={"value": "0.32"})
    sport = dict(copy.deepcopy(ms[0]), slug="aec-nfl-mia-buf-2026-11-22", category="sports", id="9")
    twin = dict(copy.deepcopy(ms[0]), slug="cpc-twin", id="10")
    return fetch(ms + [sport, twin])


def test_score_maps_categories_prices_at_us_fee_and_links_to_us():
    model = StubModel()
    rows = us_native.score(model, native_fixture(), NOW, {}, {}, events=EV(), log=lambda *a: None, skip={"cpc-twin"})
    by = {r["market_slug"]: r for r in rows}
    # in window: BTC daily (crypto, 4.5 h -> 6 h node), gas weekly (macro -> finance), tech (72 h);
    # out: aliens (closes Jan), gold (no bid), sports (not native), the twin (already matched to an intl row)
    assert set(by) == {"cpc-btc-hit-h-w-2026-11-20-80000", "aaagaspc-usgas-loww-2026-11-22-lt3pt6800",
                       "aimrc-company1-2026-12-31-openai"}
    btc, gas, tech = (by[s] for s in ("cpc-btc-hit-h-w-2026-11-20-80000",
                                      "aaagaspc-usgas-loww-2026-11-22-lt3pt6800", "aimrc-company1-2026-12-31-openai"))
    assert (btc["category"], gas["category"], tech["category"]) == ("crypto", "finance", "tech")
    assert btc["niche"] == "bitcoin" and gas["niche"] == "finance"
    # close = the event's endDate (gas weekly: Nov 22 05:00Z, 35 h; its market endDate says Nov 30)
    assert btc["horizon_h"] == 6 and tech["horizon_h"] == 72 and gas["horizon_h"] == 24
    assert btc["closes_at"] == parse_ts("2026-11-20T22:00:00Z")
    for r in rows:
        assert r["venue"] == "us" and r["url"] == f"https://polymarket.us/event/{r['slug']}"
        assert r["id"].startswith("us-") and r["tokens"] == ["", ""] and r["market_type"] == "yes/no"
        b = r["best"]
        assert r["us"] == dict(slug=r["market_slug"], url=r["url"], side=b["side_index"], ask=b["ask"],
                               fee=b["fee"], edge=b["edge"], roi_pct=b["roi_pct"])
        for s in r["sides"]:  # US taker fee: 0.095 * p * (1 - p)
            assert s["fee"] == pytest.approx(round(0.095 * s["ask"] * (1 - s["ask"]), 4))
    # BTC: bid 1c, ask 2c. Long side costs the ask, short side 1 - bid
    sides = {s["side_index"]: s for s in btc["sides"]}
    assert sides[0]["ask"] == 0.02 and sides[0]["outcome"] == "Yes" and sides[1]["ask"] == 0.99
    assert sides[0]["mid"] == 0.015 and sides[1]["mid"] == 0.985
    assert btc["slug"] == "btc-hit-h-w-2026-11-20" and btc["event_id"].startswith("us:") and btc["event_id"] != "us:"
    assert btc["question"].startswith("How high will BTC get") and btc["event"].startswith("How high")


def test_markets_outside_an_open_event_are_skipped():
    ev = EV()
    ev.pop("aimrc-company1-2026-12-31-openai")
    rows = us_native.score(StubModel(), native_fixture(), NOW, {}, {}, events=ev, log=lambda *a: None)
    assert "aimrc-company1-2026-12-31-openai" not in {r["market_slug"] for r in rows}


def test_native_rows_never_shadow_the_twin_scan():
    rows = us_native.score(StubModel(), native_fixture(), NOW, {}, {}, events=EV(), log=lambda *a: None,
                           skip={"cpc-btc-hit-h-w-2026-11-20-80000"})
    assert "cpc-btc-hit-h-w-2026-11-20-80000" not in {r["market_slug"] for r in rows}


BOOK = {"marketData": {"marketSlug": "x", "bids": [{"px": {"value": "0.0100"}, "qty": "1438.02"}],
                       "offers": [{"px": {"value": "0.0200"}, "qty": "51.52"},
                                  {"px": {"value": "0.1900"}, "qty": "3000"}]}}


def test_book_mirrors_the_short_side():
    get = lambda method, url, **kw: BOOK  # noqa: E731
    long_ = v.book("x", 0, get=get)
    assert long_["asks"][0] == dict(price=0.02, size=51.52) and long_["bids"][0] == dict(price=0.01, size=1438.02)
    short = v.book("x", 1, get=get)
    assert short["asks"] == [dict(price=0.99, size=1438.02)]
    assert short["bids"] == [dict(price=0.98, size=51.52), dict(price=0.81, size=3000.0)]


def test_enrich_checks_the_us_book_at_the_us_fee():
    rows = us_native.score(StubModel(), native_fixture(), NOW, {}, {}, events=EV(), log=lambda *a: None)
    btc = next(r for r in rows if r["market_slug"].startswith("cpc-btc"))
    seen = []

    def get(method, url, **kw):
        seen.append(url)
        if "usgas" in url:
            raise RuntimeError("503")
        return BOOK

    us_native.enrich(Config(flag_min_edge=0.02), rows, log=lambda *a: None, get=get)
    assert any(u.endswith("/v1/markets/cpc-btc-hit-h-w-2026-11-20-80000/book") for u in seen)
    gas = next(r for r in rows if "usgas" in r["market_slug"])
    assert gas["execution"]["verdict"] == "no book" and gas["execution"]["book_ok"] is False
    ex = btc["execution"]
    assert ex["book_ok"] and ex["ask_size"] is not None
    side = btc["best"]["side_index"]
    want_ask = 0.02 if side == 0 else 0.99
    assert ex["best_ask"] == want_ask
    assert ex["fee_at_ask"] == pytest.approx(round(0.095 * want_ask * (1 - want_ask), 4))


def native_flag(q=0.5):
    r = us_native.score(StubModel(), native_fixture(), NOW, {}, {}, events=EV(), log=lambda *a: None)[0]
    r["execution"] = dict(verdict="worth it")
    return r


def test_ledger_books_native_rows_in_the_us_record_and_grades_from_us(tmp_path):
    cfg = Config(output_dir=str(tmp_path))
    r = native_flag()
    intl = dict(id="1", question="q", category="sports", niche="nfl", tokens=["a", "b"], closes_at=1, event_id="e",
                us=None, best=dict(side_index=0, outcome="Over", ask=0.5, fee=0.01, win_prob=0.6, edge=0.05),
                execution=dict(verdict="worth it"), sides=[])
    ledger.append(cfg, [r, intl], now=1, rows=[r, intl])
    rows = jl_read(cfg.path("output", "ledger.jsonl"))
    nat = rows[0]
    assert nat["venue"] == "us" and nat["token"] is None and nat["us_slug"] == r["market_slug"]
    assert nat["us_ask"] == nat["ask"] and nat["us_side"] == nat["side_index"]
    # comparison bets never come from US-native rows (they'd be graded on Gamma)
    assert all(not c["id"].startswith("us-") for c in jl_read(cfg.path("output", "control.jsonl")))
    long_won = 1.0 if nat["side_index"] == 0 else 0.0
    s = ledger.grade(cfg, get_market=lambda mid: (_ for _ in ()).throw(AssertionError(mid))
                     if mid.startswith("us-") else dict(closed=True, outcomePrices='["1","0"]'),
                     get_history=lambda t: [], now=10, log=lambda *a: None,
                     get_us_settlement={r["market_slug"]: long_won}.get)
    nat = jl_read(cfg.path("output", "ledger.jsonl"))[0]
    assert nat["result"] == "won" and nat["us_result"] == "won" and nat["us_settled_by"] == "us"
    assert nat["pnl"] == pytest.approx(round(1 - nat["ask"] - nat["fee"], 4)) and nat["clv"] is None
    assert s["us"]["graded"] == 1 and s["intl_only"]["graded"] == 1
    assert s["us"]["by_category"][r["category"]]["wins"] == 1


def test_unsettled_native_rows_stay_open(tmp_path):
    cfg = Config(output_dir=str(tmp_path))
    ledger.append(cfg, [native_flag()], now=1)
    ledger.grade(cfg, get_market=lambda mid: pytest.fail("gamma"), get_history=lambda t: [], now=10,
                 log=lambda *a: None, get_us_settlement=lambda slug: None)
    assert "result" not in jl_read(cfg.path("output", "ledger.jsonl"))[0]


def run_scan(tmp_path, monkeypatch, on):
    cfg = Config(output_dir=str(tmp_path), instance="t", platform="polymarket", flag_min_edge=0.02,
                 flag_confidence_z=1.28, price_min=0.05, price_max=0.95, edge_tier={}, us_native_scan=on)
    json.dump({}, open(cfg.path("output", "model.json"), "w"))
    model = StubModel()
    model.hl = 60
    monkeypatch.delenv("US_NATIVE_SCAN", raising=False)
    monkeypatch.setattr(scan.Model, "from_json", classmethod(lambda cls, c, d: model))
    monkeypatch.setattr(scan, "fetch_open", lambda c, log: [])
    us = native_fixture()
    monkeypatch.setattr(v, "fetch_open", lambda log=print: us)
    ev = EV()  # before patching: EV() runs the real fetch_events on a stub getter
    monkeypatch.setattr(v, "fetch_events", lambda cats, log=print: ev)
    book = v.book

    def top_of_book(slug, side, get=None):  # one level at the listed bid/ask
        m = us[slug]
        lv = lambda p: [{"px": {"value": str(p)}, "qty": "500"}]  # noqa: E731
        return book(slug, side, get=lambda *a, **k: {"marketData": dict(bids=lv(m["bid"]), offers=lv(m["ask"]))})

    monkeypatch.setattr(v, "book", top_of_book)
    monkeypatch.setattr(scan.time, "time", lambda: NOW)
    return cfg, scan.run(cfg, log=lambda *a: None)


def test_scan_run_flag_off_adds_nothing(tmp_path, monkeypatch):
    cfg, meta = run_scan(tmp_path, monkeypatch, on=False)
    assert meta["us"]["native"] == 0 and meta["markets_scanned"] == 0


def test_scan_run_flag_on_scores_native_rows_end_to_end(tmp_path, monkeypatch):
    cfg, meta = run_scan(tmp_path, monkeypatch, on=True)
    assert meta["us"]["native"] == 4 and meta["markets_scanned"] == 4  # the "twin" too: no intl row matched it
    mk = json.load(open(cfg.path("output", "markets.json")))["markets"]
    assert all(r["venue"] == "us" and r["us"] for r in mk)
    assert json.load(open(cfg.path("output", "events.json"))) == {}  # no polymarket.com pages
    flags = json.load(open(cfg.path("output", "flags.json")))["flags"]
    best = [f for f in flags if f["tier"] == "best"]
    assert [f["market_slug"] for f in best] == ["aimrc-company1-2026-12-31-openai"]
    assert meta["tiers"]["best"] == 1 and all(f["execution"]["book_ok"] for f in flags)
    assert best[0]["execution"]["best_ask"] == 0.32 and best[0]["execution"]["verdict"] == "thin"  # 3c of 6c left
    logged = jl_read(cfg.path("output", "ledger.jsonl"))
    assert {e["id"] for e in logged} == {f["id"] for f in best} and all(e["venue"] == "us" for e in logged)
