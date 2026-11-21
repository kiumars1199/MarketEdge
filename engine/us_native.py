"""US-native scan (docs/OVERHAUL.md §G4): Polymarket US markets with no international twin, scored directly.

Polymarket US politics, culture, crypto, macro/finance and technology contracts don't match international ones
(different wording, dates and strikes; docs/research/polymarket-us.md §4), so the twin matcher finds none. Here
the model runs on the US market itself, at US prices, with US's taker fee (feeCoefficient, Θ = 0.095:
fee = Θ·p·(1−p)). Rows get `venue: "us"`, a polymarket.us link and a `us` quote equal to their best side, so
the ledger books them in the US record and grades them from US's own settlement.

Off by default: US_NATIVE_SCAN=1 (env) or "us_native_scan": true (config) turns it on; the env var wins.

Side 0 is the US long side (venue_us.fetch_open puts it first), side 1 the short side at 1 − bid.
Events come from /v1/events (venue_us.fetch_events): the event slug makes the link (venue_us.US_URL), the event
id groups a price ladder into one event, and the event's endDate is the close time. A market's own endDate is
the settlement deadline (+30 min for crypto hourlies, about a week for gas weeklies), so it is only a fallback.
A market missing from the events listing has no link and is skipped. Only markets closing within the model's
window (0.5 h–10 days) score. Market type is "yes/no": US doesn't mark mutually exclusive groups (a BTC price
range ladder is one), so those score on the yes/no curve. The US listing has no volume or liquidity (0).
"""
import os
import re

from pipeline import venue_us
from pipeline.common import http, parse_ts

# Polymarket US category -> Kismet category
CATEGORY = {"politics": "politics", "culture": "culture", "crypto": "crypto", "macro": "finance",
            "finance": "finance", "technology": "tech"}
# slug token -> model niche (used when the fitted model knows it; else the category node)
NICHE = [(re.compile(r"(^|-)(btc|bitcoin)(-|$)"), "bitcoin"), (re.compile(r"(^|-)(eth|ethereum|cpceth)(-|$)"), "ethereum"),
         (re.compile(r"(^|-)(sol|solana)(-|$)"), "solana"), (re.compile(r"(^|-)xrp(-|$)"), "xrp"),
         (re.compile(r"(^|-)(usfed|fed|fomc)(-|$)"), "fed")]


def enabled(cfg):
    v = os.environ.get("US_NATIVE_SCAN")
    if v is not None and v.strip() != "":
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(cfg.get("us_native_scan"))


def _niche(slug, cat, vocab):
    for rx, name in NICHE:
        if rx.search(slug) and name in vocab:
            return name
    return cat


def score(model, us, now, record, hrecord, events=None, log=print, skip=()):
    """Scan rows for open US markets in CATEGORY, priced at US asks with US's fee. `us` = venue_us.fetch_open()
    output; `events` = venue_us.fetch_events() output (fetched here when None); `skip` = US slugs already
    attached to an international row as its twin."""
    from .scan import is_validated, nearest_h, score_sides
    if events is None:
        try:
            events = venue_us.fetch_events(list(CATEGORY), log=log)
        except Exception as err:  # noqa: BLE001  extra data; never fail the scan on it
            log(f"polymarket us native: skipped, no events ({err})")
            return []
    V = model.vocab
    out, seen, no_event = [], 0, 0
    for m in us.values():
        cat = CATEGORY.get(m.get("category"))
        if cat is None or m["slug"] in skip:
            continue
        seen += 1
        ev = events.get(m["slug"])
        if ev is None:
            no_event += 1
            continue
        bid, ask = m.get("bid"), m.get("ask")
        if bid is None or ask is None or not (0 < bid < ask < 1) or cat not in V["cat"] \
                or "yes/no" not in V["mt"]:
            continue
        refs = [t for t in (parse_ts(ev.get("end")), parse_ts(m.get("end")), parse_ts(m.get("start")))
                if t and t > now]
        if not refs:
            continue
        hours = (min(refs) - now) / 3600
        h = nearest_h(hours)
        if h is None:
            continue
        niche = _niche(m["slug"], cat, V["niche"])
        n = V["niche"].index(niche) if niche in V["niche"] else -1
        c, t = V["cat"].index(cat), V["mt"].index("yes/no")
        mid = (bid + ask) / 2
        outs, rate = m["outcomes"], m.get("fee") or venue_us.US_FEE
        sides = score_sides(model, (h, c, n, t), ((0, outs[0], ask, mid), (1, outs[1], 1 - bid, 1 - mid)),
                            lambda p, rate=rate: rate * p * (1 - p))
        if not sides:
            continue
        best = max(sides, key=lambda s: s["edge"])
        url = venue_us.market_url(m["slug"], ev["slug"])
        title = (m.get("title") or "").strip()
        q = m["question"].strip()
        out.append(dict(
            id=f"us-{m.get('id') or m['slug']}", question=f"{q}: {title}" if title and title.lower() not in q.lower()
            else q, event=ev["title"] or q, event_id=f"us:{ev['id'] or ev['slug']}", tokens=["", ""],
            slug=ev["slug"], market_slug=m["slug"],
            image=None, url=url, venue="us", category=cat, niche=niche, market_type="yes/no",
            tags=["polymarket-us", m.get("category") or ""], hours_to_close=round(hours, 2), horizon_h=h,
            closes_at=int(min(refs)), volume=0.0, backtest=record.get(cat),
            validated=is_validated(record, hrecord, cat, h), liquidity=0.0, spread=round(ask - bid, 4),
            volume_24h=None, created_at=None, competitive=round(abs(mid - 0.5), 4), sides=sides, best=best,
            us=dict(slug=m["slug"], url=url, side=best["side_index"], ask=best["ask"], fee=best["fee"],
                    edge=best["edge"], roi_pct=best["roi_pct"])))
    log(f"polymarket us native: {len(out)} scored of {seen} open US markets in {sorted(CATEGORY)} "
        f"({no_event} not in an open event)")
    return out


def enrich(cfg, rows, log=print, get=http):
    """execution.check on the US order book of each row's best side (the twin of execution.enrich, which reads
    international CLOB books by token)."""
    from .execution import _levels, check
    n = 0
    for r in rows:
        try:
            b = venue_us.book(r["market_slug"], r["best"]["side_index"], get=get)
        except RuntimeError as err:
            log(f"us book {r['market_slug']}: {err}")
            b = None
        if not b or not (b["asks"] or b["bids"]):
            r["execution"] = dict(verdict="no book", book_ok=False, ask_size=None, bid_size=None)
            continue
        n += 1
        r["execution"] = check(r["best"]["win_prob"], b, venue_us.US_FEE, cfg.flag_min_edge)
        for side, key in (("asks", "ask_size"), ("bids", "bid_size")):
            lv = _levels(b, side)
            r["execution"][key] = lv[0][1] if lv else None
    if rows:
        log(f"us order books checked: {n} of {len(rows)}")
    return rows
