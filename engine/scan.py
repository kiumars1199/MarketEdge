"""Score every open Polymarket market with the fitted model.

Outputs (all in output/, read by the UI):
  markets.json  every scanned market: both sides, model win prob, edge at the current ask
  flags.json    the subset that passes the flag rule (edge >= min AND confident)
  events.json   event slug -> event id, market ids, flag ids (lookup for the extension)
  spreads.json  live bid/ask spread by segment, used by the backtest as real trading cost
"""
import json
import math
import time
from collections import defaultdict

import numpy as np

from pipeline.common import GAMMA, SAMPLE_TAGS, classify, http, parse_ts, taker_fee
from .dataset import HORIZONS, market_type
from .model import Model


def nearest_h(hours):
    if hours < 0.5 or hours > 240:
        return None
    return min(HORIZONS, key=lambda h: abs(math.log(hours) - math.log(h)))


def fetch_open(cfg, log=print):
    seen, out = set(), []
    for tag in SAMPLE_TAGS:
        for off in range(0, cfg.scan_events_per_tag, 100):
            evs = http("GET", f"{GAMMA}/events", params=dict(
                limit=100, offset=off, closed="false", active="true", order="volume",
                ascending="false", tag_slug=tag))
            for e in evs:
                tags = [t.get("slug") for t in (e.get("tags") or []) if t.get("slug")]
                cat, niche = classify(tags)
                for m in e.get("markets") or []:
                    if m.get("id") in seen or m.get("closed") or not m.get("acceptingOrders"):
                        continue
                    seen.add(m["id"])
                    out.append((e, m, cat, niche, tags))
            if len(evs) < 100:
                break
    log(f"open markets fetched: {len(out)}")
    return out


def is_edge(cfg, r):
    """Tier "edge" / "More bets with an edge" (docs/18 §2), before the order-book check:
    edge after fee at the ask >= min_edge at any payout, lower price floor, and a model
    node with enough effective samples. Not validated, no edge_low requirement."""
    s, et = r["best"], cfg.edge_tier or {}
    return (et.get("price_min", 0.03) <= s["mid"] < cfg.price_max and abs(s["mid"] - 0.5) >= 0.005
            and s["edge"] >= cfg.flag_min_edge and s["model_neff"] >= et.get("min_neff", 40))


def score_sides(model, node, quotes, fee_of):
    """Model win chance and edge for each side. node = (h, cat, niche, mt) codes; quotes = (side_index, outcome,
    price to buy, side mid); fee_of(price) = taker fee per share at that price (venue-specific)."""
    h, c, n, t = node
    sides = []
    for side, outcome, price, smid in quotes:
        r = model.predict(smid, h, c, n, t)
        if r is None:
            continue
        q, lo, key, nd = float(r[0][0]), float(r[1][0]), r[2], r[3]
        fee = fee_of(price)
        cost = price + fee
        sides.append(dict(
            side_index=side, outcome=outcome, ask=round(price, 4), mid=round(smid, 4), fee=round(fee, 4),
            win_prob=round(q, 4), win_prob_low=round(lo, 4),
            edge=round(q - cost, 4), edge_low=round(lo - cost, 4),
            roi_pct=round((q - cost) / cost * 100, 2),
            model_level=key[0], model_neff=round(nd["neff"], 1), model_events=nd["events"]))
    return sides


def is_validated(record, hrecord, cat, h):
    """This category's flags made money in the walk-forward test and flags at this time-to-close did too."""
    return all(bool(rec and rec["flags"] >= 100 and (rec["pnl_cents"] or 0) > 0 and (rec["t"] or 0) >= 2)
               for rec in (record.get(cat), hrecord.get(h)))


VERDICT_RANK = {"worth it": 0, "thin": 1}


def rank_key(r):
    """How the scan orders bets: verdict first, then net edge at the live book."""
    ex = r.get("execution") or {}
    return VERDICT_RANK.get(ex.get("verdict"), 2), -(ex.get("net_edge") if ex.get("net_edge") is not None else -1)


def cap_per_event(flags, k, held=None):
    """At most k Best bets per event (game), so one game's 20 lines can't flood the list or the live record
    (docs/OVERHAUL.md §G5). Ranked by rank_key. `held` = {event_id: {(market id, side_index)}} already in the
    ledger: those lines keep their slots, so the record stays capped across scans, not just within one.
    Returns (kept, capped_out). k None/0 = no cap."""
    if not k:
        return list(flags), []
    held = held or {}
    by_ev = {}
    for r in flags:
        by_ev.setdefault(r.get("event_id") or r["id"], []).append(r)
    keep_ids = set()
    for ev, rs in by_ev.items():
        mine = held.get(ev) or set()
        old = [r for r in rs if (r["id"], r["best"]["side_index"]) in mine]
        new = sorted((r for r in rs if (r["id"], r["best"]["side_index"]) not in mine), key=rank_key)
        free = max(0, k - len(mine))
        keep_ids.update(id(r) for r in old + new[:free])
    kept = [r for r in flags if id(r) in keep_ids]
    return kept, [r for r in flags if id(r) not in keep_ids]

def under_edge_cap(cfg, edge):
    """T-296 (docs/research/live-vs-backtest.md): optional cap on the predicted edge of a Best bet. Config key
    `flag_max_edge` (per $1 share, e.g. 0.10); absent or null = off, the default. Live, flags the model rated 10c+
    did no better than the rest, and in testing the 10-15c bucket was the one that earned less than predicted."""
    cap = cfg.flag_max_edge
    return cap is None or edge < cap


def is_best(cfg, r, has_record=True):
    """Tier "best": price in range, edge after fee >= min (and under the optional cap), still > 0 on the
    pessimistic estimate, and validated by the walk-forward test (when one has run)."""
    s = r["best"]
    return (cfg.price_min <= s["mid"] < cfg.price_max and abs(s["mid"] - 0.5) >= 0.005
            and s["edge"] >= cfg.flag_min_edge and under_edge_cap(cfg, s["edge"]) and s["edge_low"] > 0
            and (r["validated"] or not has_record))


def attach_us(rows, log=print, fetch=None):
    """Polymarket US twin of each row (docs/research/polymarket-us.md): `us` = the best side priced on US with
    US's taker fee, or None when the market isn't listed there. US users can only trade these. A US outage
    leaves every `us` None and the scan goes on."""
    from pipeline import venue_us
    for r in rows:
        r["us"] = None
    try:
        us = (fetch or venue_us.fetch_open)(log=log)
    except Exception as err:  # noqa: BLE001  the US venue is extra data; never fail the scan on it
        log(f"polymarket us: skipped ({err})")
        return dict(ok=False, markets=0, matched=0)
    idx = venue_us.index(us)
    matched = 0
    for r in rows:
        side0 = next((s for s in r["sides"] if s["side_index"] == 0), None)
        mid0 = side0["mid"] if side0 else 1 - r["best"]["mid"]
        hit = venue_us.match(dict(market_slug=r.get("market_slug"), question=r.get("question"),
                                  outcomes=r.get("outcomes"), mid0=mid0), idx)
        if hit is None:
            continue
        b = r["best"]
        r["us"] = venue_us.quote(hit, b["side_index"], b["win_prob"])
        matched += 1
    for r in rows:
        r.pop("outcomes", None)  # matching input only; sides[].outcome carries the names in the output files
    log(f"polymarket us: {matched} of {len(rows)} scanned markets are on Polymarket US")
    return dict(ok=True, markets=len(us), matched=matched)


def run(cfg, log=print):
    d = json.load(open(cfg.path("output", "model.json")))
    model = Model.from_json(cfg, d)
    V = model.vocab
    now = time.time()
    rows, spreads = [], defaultdict(list)
    # category track record from the latest walk-forward test (if one has run)
    record, hrecord = {}, {}
    try:
        bt = json.load(open(cfg.path("output", "backtest.json")))
        r = bt["results"].get(str(bt.get("chosen_half_life_days")))
        if r:
            for c, sc in r["by_category"].items():
                record[c] = dict(flags=sc.get("flags", 0), pnl_cents=sc.get("pnl_cents_per_share"),
                                 t=sc.get("t_stat", 0))
            for h, sc in r["by_horizon"].items():
                hrecord[int(h)] = dict(flags=sc.get("flags", 0), pnl_cents=sc.get("pnl_cents_per_share"),
                                       t=sc.get("t_stat", 0))
    except (FileNotFoundError, KeyError, ValueError):
        pass
    for e, m, cat, niche, tags in fetch_open(cfg, log):
        outs = json.loads(m.get("outcomes") or "[]")
        bid, ask = m.get("bestBid"), m.get("bestAsk")
        refs = [parse_ts(m.get(k)) for k in ("endDate", "gameStartTime")]
        refs = [r for r in refs if r]
        if len(outs) != 2 or bid is None or ask is None or not refs:
            continue
        bid, ask = float(bid), float(ask)
        if not (0 < bid < ask < 1):
            continue
        mt = market_type(cat, m.get("sportsMarketType"), m.get("negRisk"))
        hours = (min(refs) - now) / 3600
        h = nearest_h(hours)
        mid = (bid + ask) / 2
        spreads[(niche, mt)].append(ask - bid)
        if h is None or cat not in V["cat"] or mt not in V["mt"]:
            continue
        # a niche the model has not seen yet (new in NICHE_TAGS, before a refit) uses its category node
        n = V["niche"].index(niche) if niche in V["niche"] else -1
        c, t = V["cat"].index(cat), V["mt"].index(mt)
        sides = score_sides(model, (h, c, n, t), ((0, outs[0], ask, mid), (1, outs[1], 1 - bid, 1 - mid)),
                            lambda p, cat=cat: taker_fee(cat, p))
        if not sides:
            continue
        best = max(sides, key=lambda s: s["edge"])
        rows.append(dict(
            id=m["id"], question=m.get("question"), event=e.get("title"), event_id=e.get("id"),
            tokens=json.loads(m.get("clobTokenIds") or "[]"), slug=e.get("slug"), market_slug=m.get("slug"),
            outcomes=outs,
            image=e.get("icon") or e.get("image"),
            url=f"https://polymarket.com/event/{e.get('slug')}", category=cat, niche=niche,
            market_type=mt, tags=tags, hours_to_close=round(hours, 2), horizon_h=h,
            closes_at=int(min(refs)), volume=round(float(m.get("volumeNum") or 0), 2),
            backtest=record.get(cat),
            validated=is_validated(record, hrecord, cat, h),
            liquidity=round(float(m.get("liquidityNum") or 0), 2), spread=round(ask - bid, 4),
            volume_24h=(round(float(m["volume24hr"]), 2) if m.get("volume24hr") is not None else None),
            created_at=(int(c_ts) if (c_ts := parse_ts(m.get("createdAt"))) else None),
            # distance of the market mid from 50c; same for both sides (side 1 mid = 1 - side 0 mid)
            competitive=round(abs(mid - 0.5), 4),
            sides=sides, best=best))

    def is_flag(r):
        return is_best(cfg, r, bool(record))

    from . import us_native
    us_cache = {}

    def fetch_us(log=log):  # one pull of the US venue serves both the twin matcher and the US-native scan
        from pipeline import venue_us
        us_cache["us"] = venue_us.fetch_open(log=log)
        return us_cache["us"]

    us_meta = attach_us(rows, log, fetch=fetch_us)
    native = []
    if us_native.enabled(cfg) and us_cache.get("us"):
        native = us_native.score(model, us_cache["us"], now, record, hrecord, log=log,
                                 skip={r["us"]["slug"] for r in rows if r.get("us")})
        rows += native
    us_meta["native"] = len(native)
    flags = [r for r in rows if is_flag(r)]
    edge = [r for r in rows if not is_flag(r) and is_edge(cfg, r)]
    # check every flag against the live order book (ask vs mid, depth, capacity)
    from pipeline.common import FEE_RATE
    from .execution import enrich
    enrich(cfg, [r for r in flags + edge if r.get("venue") != "us"], FEE_RATE, log)
    us_native.enrich(cfg, [r for r in flags + edge if r.get("venue") == "us"], log)
    # tier "edge" also needs a live book; flags stay a superset-free list: each row has one tier
    edge = [r for r in edge if r["execution"].get("book_ok")]
    # at most max_best_per_event Best bets per game (ledger-aware); a capped line can still be tier "edge"
    from . import ledger
    flags, capped = cap_per_event(flags, cfg.get("max_best_per_event", 2), held=ledger.held_by_event(cfg))
    edge += [r for r in capped if is_edge(cfg, r) and r["execution"].get("book_ok")]
    for r in flags:
        r["tier"] = "best"
    for r in edge:
        r["tier"] = "edge"
    best_flags = flags
    flags = flags + edge
    # realistic edge: what flags with this predicted edge actually earned in the backtest
    buckets = []
    try:
        bt = json.load(open(cfg.path("output", "backtest.json")))
        buckets = bt["results"][str(bt.get("chosen_half_life_days"))].get("edge_buckets", [])
    except (FileNotFoundError, KeyError, ValueError):
        pass
    for r in flags:
        e = r["best"]["edge"]
        bk = next((b for b in buckets if b["predicted_lo"] <= e < b["predicted_hi"]), None)
        r["best"]["realistic_edge"] = (round(min(e, bk["realized_edge"]), 4) if bk else None)
        if e >= 0.15:
            r["execution"]["warning"] = ("Edge looks too good: in testing, flags above 15c "
                                         "earned far less than predicted.")
    rank = {"worth it": 0, "thin": 1}
    flags.sort(key=lambda r: (r["tier"] != "best", rank.get(r["execution"]["verdict"], 2),
                              -(r["execution"].get("net_edge") or -1)))
    meta = dict(instance=cfg.instance, platform=cfg.platform, scanned_at=int(now),
                model_half_life_days=model.hl, markets_scanned=len(rows), flags=len(flags),
                tiers=dict(best=len(best_flags), edge=len(edge)),
                capped=len(capped),
                verdicts={v: sum(1 for r in flags if r["execution"]["verdict"] == v)
                          for v in ("worth it", "thin", "not worth it", "no sellers", "no book")},
                rule=dict(min_edge=cfg.flag_min_edge, confidence_z=cfg.flag_confidence_z,
                          price_range=[cfg.price_min, cfg.price_max]),
                us=dict(us_meta, best_on_us=sum(1 for r in best_flags if r.get("us")),
                        best_us_edge=sum(1 for r in best_flags
                                         if (r.get("us") or {}).get("edge") is not None
                                         and r["us"]["edge"] >= cfg.flag_min_edge)))
    json.dump(dict(meta=meta, markets=rows), open(cfg.path("output", "markets.json"), "w"))
    json.dump(dict(meta=meta, flags=flags), open(cfg.path("output", "flags.json"), "w"), indent=1)
    # track record = Best bets only; plus one random same-payout bet per new pick (control.jsonl)
    log(f"ledger: {ledger.append(cfg, best_flags, now, rows=rows)} new rows")
    # slug -> event index, so the extension can look up a Polymarket page by its URL slug
    # (polymarket.com pages only: US-native rows have no international page)
    events = {}
    for r in rows:
        if r.get("venue") == "us":
            continue
        ev = events.setdefault(r["slug"], dict(event_id=r["event_id"], event=r["event"],
                                               market_ids=[], flag_ids=[]))
        ev["market_ids"].append(r["id"])
    for r in best_flags:  # flag_ids = Best bets only (the extension badges these)
        if r.get("venue") != "us":
            events[r["slug"]]["flag_ids"].append(r["id"])
    json.dump(events, open(cfg.path("output", "events.json"), "w"))
    sp = {f"{k[0]}|{k[1]}": dict(n=len(v), median=round(float(np.median(v)), 4),
                                  p75=round(float(np.percentile(v, 75)), 4))
          for k, v in spreads.items() if len(v) >= 5}
    json.dump(sp, open(cfg.path("output", "spreads.json"), "w"), indent=1)
    log(f"scanned {len(rows)} markets, {len(flags)} flags")
    return meta
