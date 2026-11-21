"""Flag ledger (F-29): the live forward track record.

output/ledger.jsonl   one row per flag, appended by every scan: the first time a
                      market/side is flagged, and again whenever it is re-flagged at a
                      lower (better) ask. Rows without `result` are open.
python -m engine grade
                      for open rows whose market has resolved (Gamma /markets/{id}):
                      result, pnl = (won ? 1 : 0) - ask - fee, closing price and CLV.
                      Rewrites ledger.jsonl and writes output/ledger_summary.json.

Closing price = last CLOB trade price of the flagged side at or before (close - 1 h),
close = min(closedTime, endDate, gameStartTime) as in pipeline/fetch_closed.py, so
sports close at kickoff and the 1 h gap keeps the settled outcome out of the price.
clv = closing_price - ask (positive = the market moved toward the flag).

Polymarket US (docs/research/polymarket-us.md): a flag also listed on Polymarket US logs its US price
(us_slug, us_side, us_ask, us_fee, us_edge). The grader settles it from US's own settlement when US has
published one, else from the international result, and books us_pnl = (won ? 1 : 0) - us_ask - us_fee.
US-native rows (`venue: "us"`, engine/us_native.py) exist only on Polymarket US: their ask/fee are US prices and
they're graded from US settlement alone, so they land in the `us` block below.
The summary keeps the original numbers and adds:
  first    one row per market and side (the first time it was flagged): re-flags at a better ask are
           extra rows for the same bet and would count it twice
  us       US-listed bets only, graded at the US price and fee: what a US user could actually have done
  intl_only the rest (not available to US users)
  events   distinct events, and avg_pnl_by_event: each event's bets averaged, then events averaged
           equally, so one game with 20 lines can't outweigh 19 other games

Same-payout comparison (output/control.jsonl): every time a bet becomes a best bet for the first time, the
scan also logs one random other bet paying the same (payout band, same category when possible) at its own
asking price. The grader settles both alike, and `vs_same_payout` puts them side by side per band:
"do Kismet's picks beat another bet at the multiplier you wanted anyway?" That is the claim the product can
honestly make, so it needs its own live evidence (owners' pitch, Nov 20).
"""
import json
import os
import random
import time

from pipeline.common import CLOB, GAMMA, http, jl_read, jl_write, parse_ts
from pipeline.venue_us import US_GATEWAY
from pipeline.fetch_closed import resolved_yes


def _path(cfg):
    return cfg.path("output", "ledger.jsonl")


def _control_path(cfg):
    return cfg.path("output", "control.jsonl")


# payout bands as Results shows them (pays = 1 / ask)
PAY_BANDS = [(1.0, 1.5, "<1.5x"), (1.5, 2.0, "1.5-2x"), (2.0, 3.0, "2-3x"), (3.0, 5.0, "3-5x"),
             (5.0, 10.0, "5-10x"), (10.0, float("inf"), "10x+")]


def pay_band(ask):
    if not ask or ask <= 0:
        return None
    pays = 1 / ask
    return next((b for lo, hi, b in PAY_BANDS if lo <= pays < hi), None)


def append(cfg, flags, now, rows=None, rng=None):
    """Append new flags and re-flags at a better ask. Returns rows added.

    With `rows` (every scanned market), also logs one same-payout comparison bet per bet that is a best
    bet for the first time (append_control)."""
    p = _path(cfg)
    best_ask = {}
    for e in jl_read(p):
        k = (e["id"], e["side_index"])
        best_ask[k] = min(best_ask.get(k, 2.0), e["ask"])
    new, first = [], []
    for r in flags:
        s = r["best"]
        k = (r["id"], s["side_index"])
        if s["ask"] >= best_ask.get(k, 2.0):
            continue
        if k not in best_ask:
            first.append(r)
        best_ask[k] = s["ask"]
        toks = r.get("tokens") or []
        row = dict(
            id=r["id"], side_index=s["side_index"], outcome=s["outcome"], question=r["question"],
            category=r["category"], niche=r["niche"], ask=s["ask"], fee=s["fee"],
            win_prob=s["win_prob"], edge=s["edge"], verdict=r["execution"]["verdict"],
            flagged_at=int(now), closes_at=r["closes_at"],
            token=(toks[s["side_index"]] or None) if len(toks) == 2 else None, event_id=r.get("event_id"))
        if r.get("venue") == "us":
            row["venue"] = "us"  # US-native: priced and graded on Polymarket US only
        u = r.get("us")
        if u and u.get("ask") is not None:
            row.update(us_slug=u["slug"], us_side=u.get("side"), us_ask=u["ask"], us_fee=u["fee"],
                       us_edge=u["edge"])
        new.append(row)
    jl_write(p, new)
    if rows is not None and first:
        append_control(cfg, first, rows, flags, now, rng, logged={k[0] for k in best_ask})
    return len(new)


def held_by_event(cfg):
    """{event_id: {(market id, side_index)}} of bets already in the ledger (rows logged with an event_id).
    scan.cap_per_event lets these keep their slots so the record stays capped per game across scans."""
    out = {}
    for e in jl_read(_path(cfg)):
        if e.get("event_id"):
            out.setdefault(e["event_id"], set()).add((e["id"], e["side_index"]))
    return out


def append_control(cfg, picks, rows, flags, now, rng=None, logged=()):
    """One random other bet per new pick: same payout band, same category when there is one, never a market that
    is or was a best bet (`logged` = ids in the track record), never one already in the comparison log. Priced at
    its own ask plus fee, like the picks."""
    rng = rng or random.Random(int(now))
    p = _control_path(cfg)
    taken = {(e["id"], e["side_index"]) for e in jl_read(p)}
    flagged = {r["id"] for r in flags} | set(logged)
    pool = {}
    for r in rows:
        if r["id"] in flagged or r.get("venue") == "us":  # comparison bets are international, graded by Gamma
            continue
        for sd in r.get("sides") or []:
            b = pay_band(sd.get("ask"))
            if b is None or (r["id"], sd["side_index"]) in taken:
                continue
            pool.setdefault((b, r["category"]), []).append((r, sd))
            pool.setdefault((b, None), []).append((r, sd))
    out = []
    for pk in picks:
        b = pay_band(pk["best"]["ask"])
        cands = pool.get((b, pk["category"])) or pool.get((b, None)) or []
        cands = [c for c in cands if (c[0]["id"], c[1]["side_index"]) not in taken]
        if not cands:
            continue
        r, sd = rng.choice(cands)
        taken.add((r["id"], sd["side_index"]))
        toks = r.get("tokens") or []
        out.append(dict(
            id=r["id"], side_index=sd["side_index"], outcome=sd.get("outcome"), question=r.get("question"),
            category=r["category"], niche=r.get("niche"), ask=sd["ask"], fee=sd["fee"],
            win_prob=sd.get("win_prob"), edge=sd.get("edge"), flagged_at=int(now), closes_at=r.get("closes_at"),
            token=toks[sd["side_index"]] if len(toks) == 2 else None, event_id=r.get("event_id"),
            band=b, pick_id=pk["id"]))
    jl_write(p, out)
    return len(out)


def closing_price(m, pts):
    refs = [r for r in (parse_ts(m.get(k)) for k in ("closedTime", "endDate", "gameStartTime")) if r]
    if not refs:
        return None
    cut = min(refs) - 3600
    before = [x for x in pts if x["t"] <= cut]
    return float(max(before, key=lambda x: x["t"])["p"]) if before else None


def get_market(mid):
    return http("GET", f"{GAMMA}/markets/{mid}")


def get_history(token):
    d = http("POST", f"{CLOB}/batch-prices-history",
             json=dict(markets=[token], interval="max", fidelity=60))
    return (d.get("history") or {}).get(token) or []


def get_us_settlement(slug):
    """US settlement price of the long side (1.0 / 0.0), or None while unsettled or unknown."""
    try:
        d = http("GET", f"{US_GATEWAY}/v1/markets/{slug}/settlement", tries=2)
    except RuntimeError:
        return None
    v = d.get("settlement")
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if v in (0.0, 1.0) else None


def first_rows(entries):
    """The first logged row per market and side; later rows are re-flags of the same bet at a better ask."""
    seen, out = set(), []
    for e in entries:
        k = (e["id"], e["side_index"])
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out


def same_payout(entries, control):
    """Kismet's picks (each bet once) vs the random same-payout bets, per payout band and overall.

    Paired: a pick counts only when a comparison bet was logged for it (its id is a control row's pick_id). Picks
    logged before control.jsonl existed, or with no same-band bet to pair, are left out on both sides, so the two
    groups cover the same scans and the picks' event count is not inflated by old rows without an event_id."""
    paired = {e.get("pick_id") for e in control if e.get("pick_id") is not None}
    picks = [e for e in first_rows(entries) if e["id"] in paired]
    out = {}
    for b in [b for _, _, b in PAY_BANDS] + [None]:
        pk = [e for e in picks if b is None or pay_band(e["ask"]) == b]
        ot = [e for e in control if b is None or e.get("band") == b]
        if pk or ot:
            out[b or "all"] = dict(picks=_agg(pk), others=_agg(ot))
    return out


def _agg(es, pnl="pnl", res="result"):
    g = [e for e in es if e.get(res) in ("won", "lost") and e.get(pnl) is not None]
    cost = sum(e[pnl.replace("pnl", "ask")] + e[pnl.replace("pnl", "fee")] for e in g)
    ev = {}
    for e in g:
        ev.setdefault(e.get("event_id") or e["id"], []).append(e[pnl])
    return dict(entries=len(es), graded=len(g), wins=sum(e[res] == "won" for e in g),
                avg_pnl=round(sum(e[pnl] for e in g) / len(g), 4) if g else None,
                roi_pct=round(sum(e[pnl] for e in g) / cost * 100, 2) if cost else None,
                events=len(ev))


def summarize(entries, now):
    def agg(es, pnl="pnl", res="result"):
        g = [e for e in es if e.get(res) in ("won", "lost") and e.get(pnl) is not None]
        clv = [e["clv"] for e in g if e.get("clv") is not None]
        cost = sum(e[pnl.replace("pnl", "ask")] + e[pnl.replace("pnl", "fee")] for e in g)
        ev = {}
        for e in g:
            ev.setdefault(e.get("event_id") or e["id"], []).append(e[pnl])
        return dict(entries=len(es), graded=len(g),
                    wins=sum(e[res] == "won" for e in g),
                    losses=sum(e[res] == "lost" for e in g),
                    avg_pnl=round(sum(e[pnl] for e in g) / len(g), 4) if g else None,
                    avg_clv=round(sum(clv) / len(clv), 4) if clv else None,
                    roi_pct=round(sum(e[pnl] for e in g) / cost * 100, 2) if cost else None,
                    events=len(ev),
                    avg_pnl_by_event=round(sum(sum(v) / len(v) for v in ev.values()) / len(ev), 4)
                    if ev else None,
                    # #3: the win chance we showed vs how often those bets won (why live can trail testing)
                    avg_win_prob=round(sum(wp) / len(wp), 4) if (wp := [e["win_prob"] for e in g
                                                                         if e.get("win_prob") is not None]) else None)
    out = agg(entries)
    out["by_category"] = {c: agg([e for e in entries if e["category"] == c])
                          for c in sorted({e["category"] for e in entries})}
    first = first_rows(entries)
    out["first"] = agg(first)
    us = [e for e in first if e.get("us_ask") is not None]
    out["us"] = agg(us, pnl="us_pnl", res="us_result")
    out["us"]["by_category"] = {c: agg([e for e in us if e["category"] == c], pnl="us_pnl", res="us_result")
                                for c in sorted({e["category"] for e in us})}
    out["intl_only"] = agg([e for e in first if e.get("us_ask") is None])
    out["updated_at"] = int(now)
    return out


def _grade_us(e, intl_won, get_us_settlement):
    """US result for a US-listed row: US's own settlement when published, else the international result."""
    won, src = intl_won, "intl"
    if e.get("us_side") is not None and e.get("us_slug"):
        st = get_us_settlement(e["us_slug"])
        if st is not None:
            won, src = (st == 1.0) if e["us_side"] == 0 else (st == 0.0), "us"
    e.update(us_result="won" if won else "lost", us_pnl=round(int(won) - e["us_ask"] - e["us_fee"], 4),
             us_settled_by=src)


def grade(cfg, get_market=get_market, get_history=get_history, now=None, log=print,
          get_us_settlement=get_us_settlement):
    now = time.time() if now is None else now
    markets = {}
    entries, graded = _grade_file(_path(cfg), markets, get_market, get_history, now, log, get_us_settlement)
    control, _ = _grade_file(_control_path(cfg), markets, get_market, get_history, now, log, get_us_settlement)
    s = summarize(entries, now)
    s["vs_same_payout"] = same_payout(entries, control)
    json.dump(s, open(cfg.path("output", "ledger_summary.json"), "w"), indent=1)
    log(f"ledger: graded {graded} now, {s['graded']}/{s['entries']} graded in total")
    return s


def _grade_file(p, markets, get_market, get_history, now, log, get_us_settlement):
    if not os.path.exists(p):
        return [], 0
    entries = jl_read(p)
    graded = 0
    for e in entries:
        if "result" in e:
            if e.get("us_ask") is not None and "us_result" not in e:
                _grade_us(e, e["result"] == "won", get_us_settlement)
            continue
        if e.get("venue") == "us":  # US-native: no international market; US's own settlement only
            st = get_us_settlement(e["us_slug"]) if e.get("us_slug") else None
            if st is None:
                continue
            won = (st == 1.0) if e["side_index"] == 0 else (st == 0.0)
            e.update(result="won" if won else "lost", pnl=round(int(won) - e["ask"] - e["fee"], 4),
                     closing_price=None, clv=None, graded_at=int(now))
            _grade_us(e, won, lambda slug: st)
            graded += 1
            continue
        if e["id"] not in markets:
            try:
                markets[e["id"]] = get_market(e["id"])
            except RuntimeError as err:  # keep going; retried next run
                log(f"grade: {e['id']}: {err}")
                markets[e["id"]] = None
        m = markets[e["id"]]
        # ponytail: 50-50 / disputed resolutions stay open forever; add a "void" result if they show up
        y = resolved_yes(m) if m and m.get("closed") else None
        if y is None:
            continue
        won = (y == 1) if e["side_index"] == 0 else (y == 0)
        cp = None
        if e.get("token"):
            try:
                cp = closing_price(m, get_history(e["token"]))
            except RuntimeError:
                pass
        e.update(result="won" if won else "lost", pnl=round(int(won) - e["ask"] - e["fee"], 4),
                 closing_price=cp, clv=round(cp - e["ask"], 4) if cp is not None else None,
                 graded_at=int(now))
        if e.get("us_ask") is not None:
            _grade_us(e, won, get_us_settlement)
        graded += 1
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    os.replace(tmp, p)
    return entries, graded
