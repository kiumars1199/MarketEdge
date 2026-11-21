"""Polymarket US: the venue US users can actually trade (docs/research/polymarket-us.md).

Kismet's model and scan run on international Polymarket (gamma/clob.polymarket.com), which US residents can't
use. Polymarket US (CFTC-regulated, KYC) lists many of the same games and questions with its own order book and a
higher taker fee. This module:

  fetch_open()      every open US market from the public gateway (no key), with best bid/ask and fee coefficient,
                    one paginated listing (~80 requests, well under the 25 req/s limit)
  match(row, idx)   the US twin of an international market, oriented to the international outcome order, or None
  quote(...)        what the international best side costs on US: ask, fee, edge at the model's win chance

Matching is exact and conservative (a wrong match is worse than none):
  1. Slug rules. US slugs are `<prefix>-<core>`; sports cores share the international game key
     `<league>-<away>-<home>-<date>`. Moneylines, full/period spreads, totals and team totals are mapped by rule.
  2. Same question text (normalized) and binary outcomes, for non-sports markets that share wording.
  3. Price guard: the oriented US mid must sit within MAX_MID_GAP of the international mid, else no match.
"""
import json
import re

from .common import http

US_GATEWAY = "https://gateway.polymarket.us"
US_FEE = 0.095        # taker coefficient, Tier 1 (< $10k 30-day volume): every casual user (docs.polymarket.us/fees)
# Event page (G6 link check, Nov 20, docs/overhaul-evidence/G/NOTES.md): /event/<event slug> opens the market's
# event on desktop and iPhone browsers, and sports events redirect to /sports/<league>/<event slug>.
# /market/<market slug> does NOT: desktop gets a 307 to the home page, iPhone a 307 to an app-install link.
US_URL = "https://polymarket.us/event/{slug}"
MAX_MID_GAP = 0.12    # oriented mids further apart than this are not the same market (or one book is broken)
PAGE = 500

def _f(q):
    try:
        return float((q or {}).get("value"))
    except (TypeError, ValueError):
        return None


def _long_first(m, outs):
    """Outcomes with the long side first. bestBid/bestAsk and /settlement belong to the long side, but `outcomes`
    is not always listed in that order (on Nov 20 about half of the politics and culture futures listed "No"
    first; sports game lines were in order). marketSides[].long names the long side. Unknown -> as listed."""
    lng = next((s.get("description") for s in m.get("marketSides") or [] if s.get("long")), None)
    if lng is not None and lng == outs[1] and lng != outs[0]:
        return [outs[1], outs[0]]
    return outs


def fetch_open(get=http, log=print):
    """All open US markets as compact dicts keyed by slug. outcomes[0] is the long side (bid/ask are its prices)."""
    out, off = {}, 0
    while True:
        d = get("GET", f"{US_GATEWAY}/v1/markets", params=dict(limit=PAGE, offset=off, active="true",
                                                                  closed="false"))
        ms = d.get("markets") or []
        for m in ms:
            try:
                outs = json.loads(m.get("outcomes") or "[]")
            except ValueError:
                continue
            if len(outs) != 2 or m.get("hidden") or m.get("status") != "MARKET_STATUS_OPEN":
                continue
            out[m["slug"]] = dict(slug=m["slug"], question=m.get("question") or "", outcomes=_long_first(m, outs),
                                  bid=_f(m.get("bestBidQuote")), ask=_f(m.get("bestAskQuote")),
                                  fee=float(m.get("feeCoefficient") or US_FEE), category=m.get("category"),
                                  end=m.get("endDate"), id=str(m.get("id") or ""), title=m.get("title") or "",
                                  start=m.get("gameStartTime"))
        if len(ms) < PAGE or off > 100_000:
            break
        off += PAGE
    log(f"polymarket us: {len(out)} open binary markets")
    return out


def fetch_events(categories, get=http, log=print):
    """market slug -> its event (slug, id, title, end) for open events in `categories` (US category names).
    The markets listing has no event slug, and the event's endDate is the real close (a market's endDate is the
    settlement deadline: +30 min for crypto hourlies, about a week for gas weeklies)."""
    out = {}
    for c in categories:
        off = 0
        while True:
            es = (get("GET", f"{US_GATEWAY}/v1/events", params=dict(limit=PAGE, offset=off, active="true",
                                                                       closed="false", categories=c))
                  or {}).get("events") or []
            for e in es:
                ev = dict(slug=e.get("slug"), id=str(e.get("id") or ""), title=e.get("title") or "",
                          end=e.get("endDate"))
                for m in e.get("markets") or []:
                    if m.get("slug") and ev["slug"]:
                        out.setdefault(m["slug"], ev)
            if len(es) < PAGE or off > 100_000:
                break
            off += PAGE
    log(f"polymarket us: {len(out)} markets in open {'/'.join(categories)} events")
    return out


def event_slug(market_slug):
    """Event slug of a US sports market: its game key (`aec-nba-hou-den-2026-11-20-...` -> `nba-hou-den-2026-11-20`;
    true for all 6,744 twins matched on Nov 20, 60 of 60 checked against /v1/events/slug). None if not a game."""
    core = market_slug.split("-", 1)[1] if "-" in market_slug else market_slug
    g = _GAME.match(core)
    return f"{g['lg']}-{g['a']}-{g['b']}-{g['d']}" if g else None


def market_url(market_slug, ev_slug=None):
    """Link that opens this market's event on polymarket.us (US_URL), or the site's home page if unknown."""
    ev = ev_slug or event_slug(market_slug)
    return US_URL.format(slug=ev) if ev else "https://polymarket.us/"


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


_GAME = re.compile(r"^(?P<lg>[a-z0-9]+)-(?P<a>[a-z0-9]+)-(?P<b>[a-z0-9]+)-(?P<d>\d{4}-\d{2}-\d{2})(?P<rest>(?:-.*)?)$")
_PER = {"1h": "1h", "fh": "1h", "2h": "2h", "sh": "2h", "1q": "1q", "q1": "1q", "2q": "2q", "q2": "2q",
        "3q": "3q", "q3": "3q", "4q": "4q", "q4": "4q", "fg": ""}
_LEAGUE = {"ncaab": "cbb", "cbb": "cbb"}  # the same league under two slugs
_N = r"(?P<n>\d+pt\d)"
_P = r"(?P<p>1h|2h|1q|2q|3q|4q|fh|sh|q1|q2|q3|q4)"
# international suffixes (after the game key)
_INTL = [
    ("spread", re.compile(rf"^(?:-{_P})?-spread-(?P<side>away|home)-{_N}$")),
    ("total", re.compile(rf"^(?:-{_P})?-total-{_N}$")),
    ("tt", re.compile(rf"^(?:-{_P})?-team-total-(?P<t>[a-z0-9]+)-{_N}$")),
]
# Polymarket US suffixes, which differ by league (nfl `-total-N`, nba `-N`, nba `-fh-N`, nfl `-1h-N` ...)
_US = [
    ("spread", re.compile(rf"^(?:-{_P})?-(?P<sign>neg|pos)-{_N}$")),
    ("total", re.compile(rf"^(?:-total|-{_P})?-{_N}$")),
    ("tt", re.compile(rf"^-tt(?P<p2>1h|2h)?-(?P<t>[a-z0-9]+)(?:-(?P<p>fg|1h|2h|fh|sh))?-{_N}$")),
]


def _game(slug):
    g = _GAME.match(slug or "")
    if not g:
        return None, None
    return f"{_LEAGUE.get(g['lg'], g['lg'])}-{g['a']}-{g['b']}-{g['d']}", g["rest"]


def canon_us(core):
    """Canonical key of a US core slug, or None. Spreads are keyed by the away team's signed line."""
    gk, rest = _game(core)
    if gk is None:
        return None
    if rest == "":
        return (gk, "ml")
    for kind, rx in _US:
        m = rx.match(rest)
        if not m:
            continue
        d = m.groupdict()
        per = _PER.get(d.get("p2") or d.get("p") or "", "")
        if kind == "spread":
            return (gk, "spread", per, ("-" if d["sign"] == "neg" else "+") + d["n"])
        if kind == "total":
            return (gk, "total", per, d["n"])
        return (gk, "tt", per, d["t"], d["n"])
    return None


def canon_intl(slug):
    """(canonical key, flip) for an international market slug; flip=None means orient by outcome names."""
    gk, rest = _game(slug)
    if gk is None:
        return None, None
    if rest == "":
        return (gk, "ml"), None
    for kind, rx in _INTL:
        m = rx.match(rest)
        if not m:
            continue
        d = m.groupdict()
        per = _PER.get(d.get("p") or "", "")
        if kind == "spread":
            # away -N is US neg-N (same order); home -N is US pos-N on the away team (reversed order)
            return ((gk, "spread", per, "-" + d["n"]), False) if d["side"] == "away" else \
                   ((gk, "spread", per, "+" + d["n"]), True)
        if kind == "total":
            return (gk, "total", per, d["n"]), False
        return (gk, "tt", per, d["t"], d["n"]), False
    return None, None


def index(us):
    """Lookups: canonical sports key, US core slug (prefix stripped), normalized question -> markets."""
    canon, core, text = {}, {}, {}
    for m in us.values():
        c = m["slug"].split("-", 1)[1] if "-" in m["slug"] else m["slug"]
        core.setdefault(c, m)
        k = canon_us(c)
        if k is not None:
            canon.setdefault(k, m)
        text.setdefault(_norm(m["question"]), []).append(m)
    return dict(canon=canon, core=core, text=text)


def _subject_ok(intl_outs, us_market, flip):
    """US spreads ask 'Will the <away team> cover ...': the away team must be the international outcome US
    calls long, else the two sites disagree on who is away (then no match)."""
    q = _norm(us_market["question"])
    if not q.startswith("will the ") or " cover " not in q:
        return True
    subject = q[len("will the "):q.index(" cover ")]
    long_team = _norm(intl_outs[1] if flip else intl_outs[0])
    return bool(long_team) and long_team in subject


def _orient(intl_outs, us_outs, flip):
    """True if the US outcome order is reversed vs international, False if the same, None if unknown."""
    if flip is not None:
        return flip
    a, b = [_norm(x) for x in intl_outs], [_norm(x) for x in us_outs]
    if a == b:
        return False
    if a == b[::-1]:
        return True
    return None


def match(row, idx):
    """US twin of an international scan row (needs market_slug, question, outcomes, mid0 = side-0 mid).

    Returns dict(slug, flip, market, no_book) or None."""
    outs = row.get("outcomes") or []
    if len(outs) != 2:
        return None
    hit = None
    key, flip = canon_intl(row.get("market_slug"))
    if key is not None and (m := idx["canon"].get(key)):
        f = _orient(outs, m["outcomes"], flip)
        if f is not None and (key[1] != "spread" or _subject_ok(outs, m, f)):
            hit = (m, f)
    if hit is None and (m := idx["core"].get(row.get("market_slug") or "")):  # same core slug (soccer 3-way, props)
        f = _orient(outs, m["outcomes"], None)
        if f is not None:
            hit = (m, f)
    if hit is None and _norm(row.get("question")):
        same = idx["text"].get(_norm(row.get("question")))
        if same and len(same) == 1:
            f = _orient(outs, same[0]["outcomes"], None)
            if f is not None:
                hit = (same[0], f)
    if hit is None:
        return None
    m, flip = hit
    if m["bid"] is None or m["ask"] is None or not (0 < m["bid"] < m["ask"] < 1):
        return dict(slug=m["slug"], flip=flip, market=m, no_book=True)
    us_mid0 = (m["bid"] + m["ask"]) / 2
    if flip:
        us_mid0 = 1 - us_mid0
    if row.get("mid0") is not None and abs(us_mid0 - row["mid0"]) > MAX_MID_GAP:
        return None
    return dict(slug=m["slug"], flip=flip, market=m, no_book=False)


def side_ask(hit, side_index):
    """US price to buy international outcome `side_index` (taker, top of book)."""
    m = hit["market"]
    us_side = side_index ^ int(hit["flip"])  # 0 = US long (outcome 0), 1 = US short
    return m["ask"] if us_side == 0 else round(1 - m["bid"], 4)


def quote(hit, side_index, win_prob):
    """The best international side, priced on Polymarket US. win_prob = the model's chance for that side."""
    base = dict(slug=hit["slug"], url=market_url(hit["slug"]), side=side_index ^ int(hit["flip"]))
    if hit.get("no_book"):
        return dict(base, ask=None, fee=None, edge=None, roi_pct=None)
    ask = side_ask(hit, side_index)
    fee = hit["market"]["fee"] * ask * (1 - ask)
    cost = ask + fee
    edge = win_prob - cost
    return dict(base, ask=round(ask, 4), fee=round(fee, 4), edge=round(edge, 4),
                roi_pct=round(edge / cost * 100, 2))


def _levels(rows):
    out = []
    for x in rows or []:
        try:
            out.append((float(x["px"]["value"]), float(x["qty"])))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def book(slug, side, get=http):
    """Order book for buying US side `side` (0 = long, 1 = short) in execution.check's shape:
    {"asks": [{price, size}], "bids": [...]}. One instrument per market: buying short at 1 - p takes a long bid
    at p, so the short side's asks are the long bids mirrored (and its bids the long offers)."""
    d = (get("GET", f"{US_GATEWAY}/v1/markets/{slug}/book") or {}).get("marketData") or {}
    bids, offers = _levels(d.get("bids")), _levels(d.get("offers"))
    if side == 1:
        bids, offers = [(round(1 - p, 4), q) for p, q in offers], [(round(1 - p, 4), q) for p, q in bids]
    return dict(asks=[dict(price=p, size=q) for p, q in offers], bids=[dict(price=p, size=q) for p, q in bids])
