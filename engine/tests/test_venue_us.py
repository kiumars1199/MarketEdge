"""Polymarket US matching, pricing, scan hook and the US live record, offline."""
import pytest

from engine import ledger, scan
from engine.config import Config
from pipeline import venue_us as v
from pipeline.common import jl_read, jl_write


def us_m(slug, outs, bid, ask, q="", fee=0.095):
    return dict(slug=slug, question=q, outcomes=outs, bid=bid, ask=ask, fee=fee, category="sports", end=None)


US = {m["slug"]: m for m in [
    us_m("aec-nfl-mia-buf-2026-11-22", ["Dolphins", "Bills"], 0.08, 0.09),
    us_m("asc-nfl-mia-buf-2026-11-22-neg-2pt5", ["-2.50", "+2.50"], 0.06, 0.07,
         q="Will the Miami Dolphins cover -2.5 vs the Buffalo Bills in MIA Dolphins vs. BUF Bills?"),
    us_m("asc-nfl-mia-buf-2026-11-22-pos-8pt5", ["+8.50", "-8.50"], 0.27, 0.29,
         q="Will the Miami Dolphins cover 8.5 vs the Buffalo Bills in MIA Dolphins vs. BUF Bills?"),
    us_m("tsc-nfl-mia-buf-2026-11-22-total-44pt5", ["Over", "Under"], 0.50, 0.52),
    us_m("tsc-nfl-mia-buf-2026-11-22-1h-22pt5", ["Over", "Under"], 0.57, 0.59),
    us_m("tsc-nfl-mia-buf-2026-11-22-tt-buf-27pt5", ["Over", "Under"], 0.60, 0.64),
    us_m("tsc-nba-hou-den-2026-11-20-220pt5", ["Over", "Under"], 0.48, 0.50),
    us_m("tsc-nba-hou-den-2026-11-20-fh-110pt5", ["Over", "Under"], 0.44, 0.46),
    us_m("tsc-nba-hou-den-2026-11-20-tt-den-fg-115pt5", ["Over", "Under"], 0.52, 0.55),
    us_m("aec-cbb-duke-unc-2026-11-25", ["Blue Devils", "Tar Heels"], 0.60, 0.62),
]}
IDX = v.index(US)


@pytest.mark.parametrize("intl,us,flip", [
    ("nfl-mia-buf-2026-11-22-spread-away-2pt5", "asc-nfl-mia-buf-2026-11-22-neg-2pt5", False),
    ("nfl-mia-buf-2026-11-22-spread-home-8pt5", "asc-nfl-mia-buf-2026-11-22-pos-8pt5", True),
    ("nfl-mia-buf-2026-11-22-total-44pt5", "tsc-nfl-mia-buf-2026-11-22-total-44pt5", False),
    ("nfl-mia-buf-2026-11-22-1h-total-22pt5", "tsc-nfl-mia-buf-2026-11-22-1h-22pt5", False),
    ("nfl-mia-buf-2026-11-22-team-total-buf-27pt5", "tsc-nfl-mia-buf-2026-11-22-tt-buf-27pt5", False),
    ("nba-hou-den-2026-11-20-total-220pt5", "tsc-nba-hou-den-2026-11-20-220pt5", False),
    ("nba-hou-den-2026-11-20-1h-total-110pt5", "tsc-nba-hou-den-2026-11-20-fh-110pt5", False),
    ("nba-hou-den-2026-11-20-team-total-den-115pt5", "tsc-nba-hou-den-2026-11-20-tt-den-fg-115pt5", False),
])
def test_canonical_keys_line_up(intl, us, flip):
    k, f = v.canon_intl(intl)
    assert k is not None and k == v.canon_us(us.split("-", 1)[1]) and f is flip


def outs_for(slug):
    if "spread-away" in slug:
        return ["Dolphins", "Bills"]
    if "spread-home" in slug:
        return ["Bills", "Dolphins"]
    return ["Over", "Under"]


def test_match_spreads_orient_and_price():
    away = v.match(dict(market_slug="nfl-mia-buf-2026-11-22-spread-away-2pt5", outcomes=["Dolphins", "Bills"],
                        mid0=0.07), IDX)
    assert away["slug"].endswith("neg-2pt5") and away["flip"] is False
    home = v.match(dict(market_slug="nfl-mia-buf-2026-11-22-spread-home-8pt5", outcomes=["Bills", "Dolphins"],
                        mid0=0.72), IDX)
    assert home["flip"] is True
    # Bills -8.5 (international side 0) is the US short side: 1 - best bid
    assert v.side_ask(home, 0) == pytest.approx(0.73)
    # Dolphins +8.5 (international side 1) is the US long side at the ask
    assert v.side_ask(home, 1) == pytest.approx(0.29)


def test_moneyline_orients_by_names_and_league_alias():
    h = v.match(dict(market_slug="nfl-mia-buf-2026-11-22", outcomes=["Bills", "Dolphins"], mid0=0.915), IDX)
    assert h["flip"] is True
    h = v.match(dict(market_slug="ncaab-duke-unc-2026-11-25", outcomes=["Blue Devils", "Tar Heels"], mid0=0.61),
                IDX)
    assert h and h["slug"] == "aec-cbb-duke-unc-2026-11-25"


def test_price_guard_and_wrong_subject_reject():
    # same key, but the prices disagree by far more than MAX_MID_GAP: not the same market
    assert v.match(dict(market_slug="nfl-mia-buf-2026-11-22-total-44pt5", outcomes=["Over", "Under"],
                        mid0=0.90), IDX) is None
    # the international site calls the Bills the away team: US subject (Dolphins) disagrees
    assert v.match(dict(market_slug="nfl-mia-buf-2026-11-22-spread-away-2pt5", outcomes=["Bills", "Dolphins"],
                        mid0=0.07), IDX) is None
    assert v.match(dict(market_slug="nhl-pit-nsh-2026-11-21", outcomes=["Penguins", "Predators"], mid0=0.4),
                   IDX) is None


def test_quote_uses_us_fee():
    h = v.match(dict(market_slug="nfl-mia-buf-2026-11-22-total-44pt5", outcomes=["Over", "Under"], mid0=0.51),
                IDX)
    q = v.quote(h, 1, 0.55)  # Under: US short side, 1 - 0.50
    assert q["ask"] == pytest.approx(0.50) and q["side"] == 1
    assert q["fee"] == pytest.approx(round(0.095 * 0.5 * 0.5, 4))
    assert q["edge"] == pytest.approx(0.55 - 0.5 - 0.095 * 0.25, abs=1e-4)
    assert q["url"] == "https://polymarket.us/event/nfl-mia-buf-2026-11-22"  # the game's event page (G6)


def test_fetch_open_pages_and_filters():
    pages = [[dict(slug=f"s{i}", outcomes='["Yes","No"]', status="MARKET_STATUS_OPEN",
                   bestBidQuote={"value": "0.4"}, bestAskQuote={"value": "0.42"}, feeCoefficient=0.095)
              for i in range(v.PAGE)],
             [dict(slug="last", outcomes='["A","B"]', status="MARKET_STATUS_OPEN"),
              dict(slug="three", outcomes='["A","B","C"]', status="MARKET_STATUS_OPEN"),
              dict(slug="done", outcomes='["A","B"]', status="MARKET_STATUS_RESOLVED")]]
    calls = []

    def get(method, url, params=None, **kw):
        calls.append(params["offset"])
        return dict(markets=pages[len(calls) - 1])

    out = v.fetch_open(get=get, log=lambda *a: None)
    assert calls == [0, v.PAGE] and len(out) == v.PAGE + 1
    assert out["s0"]["ask"] == 0.42 and out["last"]["bid"] is None


def row(slug, outs, mid, side=0, q=0.6):
    s = dict(side_index=side, mid=mid if side == 0 else 1 - mid, win_prob=q)
    return dict(market_slug=slug, question="", outcomes=outs, sides=[s], best=s)


def test_attach_us_survives_outage_and_marks_rows():
    rows = [row("nfl-mia-buf-2026-11-22-total-44pt5", ["Over", "Under"], 0.51), row("x-only-intl", ["A", "B"], 0.5)]

    def boom(log):
        raise RuntimeError("gateway down")

    meta = scan.attach_us(rows, log=lambda *a: None, fetch=boom)
    assert meta["ok"] is False and all(r["us"] is None for r in rows)
    meta = scan.attach_us(rows, log=lambda *a: None, fetch=lambda log: US)
    assert meta == dict(ok=True, markets=len(US), matched=1)
    assert rows[0]["us"]["ask"] == pytest.approx(0.52) and rows[1]["us"] is None


def flag(mid, ask, us=None, ev="e1", side=0):
    return dict(id=mid, question="q", category="sports", niche="nfl", tokens=["a", "b"], closes_at=1,
                event_id=ev, us=us,
                best=dict(side_index=side, outcome="Over", ask=ask, fee=0.01, win_prob=0.6, edge=0.05),
                execution=dict(verdict="worth it"))


def test_ledger_us_record(tmp_path):
    cfg = Config(output_dir=str(tmp_path))
    us_q = dict(slug="tsc-g-total-44pt5", side=0, ask=0.52, fee=0.0237, edge=0.056)
    ledger.append(cfg, [flag("1", 0.50, us=us_q), flag("2", 0.40, ev="e2"), flag("3", 0.45, us=dict(us_q, slug="u3"))],
                  now=1)
    ledger.append(cfg, [flag("1", 0.48, us=us_q)], now=2)  # re-flag at a better ask: a second row, same bet
    markets = {"1": dict(closed=True, outcomePrices='["1","0"]'), "2": dict(closed=True, outcomePrices='["0","1"]'),
               "3": dict(closed=True, outcomePrices='["1","0"]')}
    # US settled market 3 the other way (different rules): the US record follows US
    us_settle = {"tsc-g-total-44pt5": 1.0, "u3": 0.0}
    s = ledger.grade(cfg, get_market=markets.__getitem__, get_history=lambda t: [], now=10,
                     log=lambda *a: None, get_us_settlement=us_settle.get)
    rows = jl_read(cfg.path("output", "ledger.jsonl"))
    assert [r.get("us_result") for r in rows] == ["won", None, "lost", "won"]
    assert rows[2]["us_settled_by"] == "us" and rows[2]["result"] == "won"
    assert s["entries"] == 4 and s["first"]["entries"] == 3
    assert s["us"]["graded"] == 2 and s["us"]["wins"] == 1
    assert s["us"]["avg_pnl"] == pytest.approx(round(((1 - 0.52 - 0.0237) + (0 - 0.52 - 0.0237)) / 2, 4))
    assert s["intl_only"]["graded"] == 1 and s["intl_only"]["losses"] == 1
    assert s["first"]["events"] == 2


def test_us_grading_backfills_rows_graded_before(tmp_path):
    cfg = Config(output_dir=str(tmp_path))
    jl_write(cfg.path("output", "ledger.jsonl"), [dict(
        id="1", side_index=0, category="sports", ask=0.5, fee=0.01, result="won", pnl=0.49,
        us_slug="u", us_side=1, us_ask=0.55, us_fee=0.02)])
    s = ledger.grade(cfg, get_market=lambda m: pytest.fail("re-fetched"), get_history=lambda t: [], now=5,
                     log=lambda *a: None, get_us_settlement=lambda slug: 0.0)
    r = jl_read(cfg.path("output", "ledger.jsonl"))[0]
    assert r["us_result"] == "won" and r["us_pnl"] == pytest.approx(0.43) and s["us"]["graded"] == 1


# ---- same-payout comparison group (control.jsonl) ----

def mkt(mid_, cat, asks, ev="ev"):
    sides = [dict(side_index=i, outcome=f"o{i}", ask=a, fee=0.01, win_prob=0.5, edge=0.0)
             for i, a in enumerate(asks)]
    return dict(id=mid_, question="q", category=cat, niche=cat, tokens=["a", "b"], closes_at=1, event_id=ev,
                sides=sides, best=sides[0], execution=dict(verdict="worth it"))


def test_control_samples_same_band_and_category_once_per_new_pick(tmp_path):
    import random
    cfg = Config(output_dir=str(tmp_path))
    pick = mkt("p", "sports", [0.80, 0.22])                   # pays 1.25x -> "<1.5x"
    rows = [pick,
            mkt("a", "sports", [0.78, 0.25]),                 # same band, same category
            mkt("b", "weather", [0.79, 0.24]),                # same band, other category
            mkt("c", "sports", [0.40, 0.62])]                 # other band (2.5x), and 0.62 -> 1.6x
    ledger.append(cfg, [pick], now=1, rows=rows, rng=random.Random(0))
    ctl = jl_read(cfg.path("output", "control.jsonl"))
    assert len(ctl) == 1 and ctl[0]["id"] == "a" and ctl[0]["band"] == "<1.5x" and ctl[0]["pick_id"] == "p"
    # a re-flag of the same pick at a better ask is not a new pick: no new comparison bet
    better = dict(pick, best=dict(pick["best"], ask=0.79))
    ledger.append(cfg, [better], now=2, rows=rows, rng=random.Random(0))
    assert len(jl_read(cfg.path("output", "control.jsonl"))) == 1
    # a new pick in the same band takes another market (never the same one twice), falling back across categories
    pick2 = mkt("p2", "sports", [0.81, 0.21])
    ledger.append(cfg, [pick2], now=3, rows=rows + [pick2], rng=random.Random(0))
    ids = [e["id"] for e in jl_read(cfg.path("output", "control.jsonl"))]
    assert ids == ["a", "b"]


def test_grade_reports_picks_vs_same_payout(tmp_path):
    import random
    cfg = Config(output_dir=str(tmp_path))
    pick = mkt("p", "sports", [0.80, 0.22])
    rows = [pick, mkt("a", "sports", [0.78, 0.25], ev="e2")]
    ledger.append(cfg, [pick], now=1, rows=rows, rng=random.Random(0))
    markets = {"p": dict(closed=True, outcomePrices='["1","0"]'), "a": dict(closed=True, outcomePrices='["0","1"]')}
    s = ledger.grade(cfg, get_market=markets.__getitem__, get_history=lambda t: [], now=9, log=lambda *a: None,
                     get_us_settlement=lambda slug: None)
    v = s["vs_same_payout"]
    assert v["<1.5x"]["picks"]["wins"] == 1 and v["<1.5x"]["others"]["wins"] == 0
    assert v["all"]["picks"]["avg_pnl"] == pytest.approx(1 - 0.80 - 0.01)
    assert v["all"]["others"]["avg_pnl"] == pytest.approx(0 - 0.78 - 0.01)
    assert s["entries"] == 1   # the comparison bets never enter the track record itself


def test_same_payout_counts_only_picks_with_a_comparison_bet():
    # QA-B (Marc, Nov 20): rows logged before control.jsonl existed (no event_id, no pair) must not join the picks
    old = [dict(id=f"old{i}", side_index=0, ask=0.8, fee=0.01, result="won", pnl=0.19) for i in range(5)]
    paired = [dict(id="p", side_index=0, ask=0.8, fee=0.01, result="lost", pnl=-0.81, event_id="e1"),
              dict(id="p", side_index=0, ask=0.78, fee=0.01, result="lost", pnl=-0.79, event_id="e1")]   # re-flag
    unpaired = [dict(id="q", side_index=0, ask=0.8, fee=0.01, result="won", pnl=0.19, event_id="e2")]
    control = [dict(id="a", side_index=0, ask=0.79, fee=0.01, result="won", pnl=0.2, event_id="e9",
                    band="<1.5x", pick_id="p")]
    v = ledger.same_payout(old + paired + unpaired, control)
    assert v["all"]["picks"]["entries"] == 1 and v["all"]["others"]["entries"] == 1
    assert v["all"]["picks"]["events"] == 1 and v["all"]["picks"]["wins"] == 0
    assert v["<1.5x"]["picks"]["graded"] == v["<1.5x"]["others"]["graded"] == 1
    assert ledger.same_payout(old, [])  == {}
