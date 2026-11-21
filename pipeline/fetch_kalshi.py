"""Kalshi public market data -> output/kalshi.json (docs/03 § kalshi.json).

Runs only when KALSHI_DATA_PERMISSION=true: Kalshi's Developer Agreement bars commercial reuse of its data without
written permission (docs/16 §2). Flag off = no network call at all.

Public endpoints, no key (https://docs.kalshi.com/api-reference/market/get-markets):
  GET /events?status=open&with_nested_markets=true   every open market, page by page (cursor), with its series ticker
  GET /markets?status=open&mve_filter=only           Kalshi Combos (multivariate markets) and their legs
  GET /markets?tickers=a,b,...                       leg quotes we don't have yet, and settlement results

Combo prices: Kalshi lists its combo markets publicly, but in a Nov 2026 sample none of 100 carried a resting ask
(Kalshi's RFQ endpoints need an authenticated member key; whether combos are quoted that way is unconfirmed). So each combo carries Kalshi's own quote when there is one,
and otherwise only the product of its legs' own Kalshi asks, labelled `price_basis: "legs_product"`.

QA-D (Nov 21): the crawl pages through every open event (it stopped after 3 pages), inside a hard time budget
because it runs inside the scan job, before the upload (ops/scheduler.py has no timeout: a slow crawl delays every
publish). Each stage fails on its own: a combo or settlement failure still writes the markets. `fetched_at` is the
oldest page actually used (the on-disk cache is shorter than the scan cadence, so this is at most one cache lifetime
old). kalshi.json stays bounded (top KEEP_MARKETS by volume, settlements of the last week); the full open-market dump,
the tickers awaiting settlement and the settlement history live under data/ next to the cache (never uploaded).

Field names beyond the fixture's (no_bid, last_price, volume_24h, open_interest, status, result) follow Kalshi's
documented Market object and are read in both encodings (`<name>_dollars` / `<name>_fp` and the legacy integer).
They could not be checked against the live API from the build session: every one is nullable.

Polite: small pages, a pause between calls, backoff on 429/5xx, User-Agent "Kismet scanner", on-disk cache with TTL.
"""
import hashlib
import json
import math
import os
import re
import time
from datetime import datetime

import requests

BASE = "https://api.elections.kalshi.com/trade-api/v2"
UA = "Kismet scanner"
PAGE = 100          # rows per call (Kalshi allows up to 1000; we ask for less)
DELAY_S = 0.25      # pause between network calls (4 a second; Kalshi's public tier allows more)
TTL_S = 90          # on-disk cache lifetime: below the 120 s scan cadence, so every scan sees fresh pages
CACHE_MAX_AGE_S = 86_400   # cache files older than this are deleted after each run
BUDGET_S = float(os.environ.get("KALSHI_BUDGET_SEC") or 45)   # whole run, hard wall clock
CRAWL_SHARE = 0.7   # the event crawl may use this share of the budget; combos and settlements get the rest
MAX_PAGES = 500     # safety stop for the event crawl (50,000 events)
KEEP_MARKETS = 2000         # markets in kalshi.json (top by volume; the web shows 200)
MAX_COMBOS = 25     # combos kept per run
MAX_LEGS = 6        # same limit as the combo tray (docs/18 §5)
TICKER_BATCH = 20   # tickers per /markets?tickers= call
SETTLE_PER_RUN = 100        # closed tickers re-asked for a result per run (oldest close first)
SETTLE_GIVE_UP_S = 30 * 86_400   # stop asking about a ticker this long after its close
SETTLED_KEEP_S = 7 * 86_400      # settlements kept in kalshi.json
SETTLED_MAX = 500
KEEP_FULL_S = 1800      # a partial crawl keeps the last complete crawl's other markets for up to 30 min
TRIES = 5


def enabled():
    return os.environ.get("KALSHI_DATA_PERMISSION") == "true"


class Deadline(RuntimeError):
    """The run's time budget is used up."""


_CACHE_NAME = re.compile(r"^[0-9a-f]{40}\.json$")


class Client:
    """GET with an on-disk cache, a pause between calls, backoff on 429 / 5xx and a hard deadline."""

    def __init__(self, cache_dir, ttl=TTL_S, delay=DELAY_S, session=None, sleep=time.sleep, now=time.time):
        self.cache_dir, self.ttl, self.delay = cache_dir, ttl, delay
        self.session = session or requests.Session()
        self.sleep, self.now = sleep, now
        self.last = None
        self.calls = 0
        self.deadline = None   # unix time; None = no limit
        self.oldest = None     # time of the oldest response used (cache hit = file time)

    def _used(self, t):
        self.oldest = t if self.oldest is None else min(self.oldest, t)

    def _left(self):
        return math.inf if self.deadline is None else self.deadline - self.now()

    def get(self, path, **params):
        key = hashlib.sha1(f"{path}?{json.dumps(params, sort_keys=True)}".encode()).hexdigest()
        cached = os.path.join(self.cache_dir, key + ".json")
        try:
            mtime = os.path.getmtime(cached)
            if self.now() - mtime < self.ttl:
                with open(cached) as f:
                    data = json.load(f)
                self._used(mtime)
                return data
        except (OSError, ValueError):
            pass
        for attempt in range(TRIES):
            if self._left() <= 0:
                raise Deadline(f"time budget used up before {path}")
            if self.last is not None and self.now() - self.last < self.delay:
                self.sleep(self.delay - (self.now() - self.last))
            try:   # the request timeout never runs past the deadline
                r = self.session.get(BASE + path, params=params, timeout=max(1.0, min(20.0, self._left())),
                                     headers={"User-Agent": UA, "Accept": "application/json"})
            except Exception as e:
                if self._left() <= 0:
                    raise Deadline(f"time budget used up during {path}") from e
                raise
            self.last = self.now()
            self.calls += 1
            if r.status_code == 429 or r.status_code >= 500:
                try:
                    wait = float(r.headers.get("Retry-After", ""))
                except ValueError:
                    wait = 2.0 ** attempt
                wait = min(wait, 60)
                if wait >= self._left():
                    raise Deadline(f"Kalshi {path}: rate limited and out of time")
                self.sleep(wait)
                continue
            r.raise_for_status()
            data = r.json()
            self._used(self.last)
            os.makedirs(self.cache_dir, exist_ok=True)
            with open(cached, "w") as f:
                json.dump(data, f)
            return data
        raise RuntimeError(f"Kalshi {path}: still rate limited after {TRIES} tries")

    def prune(self, max_age=CACHE_MAX_AGE_S):
        """Delete this client's own cache files older than max_age (only <sha1>.json names)."""
        try:
            names = os.listdir(self.cache_dir)
        except OSError:
            return 0
        gone = 0
        for n in names:
            p = os.path.join(self.cache_dir, n)
            try:
                if _CACHE_NAME.match(n) and self.now() - os.path.getmtime(p) > max_age:
                    os.remove(p)
                    gone += 1
            except OSError:
                pass
        return gone


def cents(m, field):
    """Price in whole cents from `<field>_dollars` (fixed-point string) or legacy integer `<field>`; None when
    there is no quote (0 or 100)."""
    try:
        c = round(float(m.get(f"{field}_dollars")) * 100)
    except (TypeError, ValueError):
        c = m.get(field) if isinstance(m.get(field), int) else None
    return c if c is not None and 0 < c < 100 else None


def count(m, field):
    """A contract count from `<field>_fp` (fixed-point string) or legacy integer `<field>`; None when absent."""
    try:
        return int(float(m.get(f"{field}_fp")))
    except (TypeError, ValueError):
        v = m.get(field)
        return v if isinstance(v, int) and not isinstance(v, bool) else None


def volume(m):
    return count(m, "volume") or 0


def series_of(event_ticker):
    return event_ticker.split("-")[0]


def url(series):
    # ponytail: series page, not the event page — Kalshi's event URLs carry a title slug the API doesn't return.
    return f"https://kalshi.com/markets/{series.lower()}"


def leg_ask(m, side):
    """What one contract of `side` costs right now, in cents."""
    if side == "yes":
        return cents(m, "yes_ask")
    ask = cents(m, "no_ask")
    if ask is None and cents(m, "yes_bid") is not None:
        ask = 100 - cents(m, "yes_bid")
    return ask


def epoch(iso):
    """ISO 8601 ("2026-11-21T04:59:00Z") -> unix seconds; None if missing or unreadable."""
    if not isinstance(iso, str) or not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def market_row(m, title, series):
    return {
        "ticker": m["ticker"],
        "event_ticker": m.get("event_ticker", ""),
        "series_ticker": series,
        "title": title or m.get("title") or m["ticker"],
        "subtitle": m.get("yes_sub_title") or "",
        "yes_bid_cents": cents(m, "yes_bid"),
        "yes_ask_cents": cents(m, "yes_ask"),
        "no_bid_cents": cents(m, "no_bid"),
        "no_ask_cents": cents(m, "no_ask"),
        "last_price_cents": cents(m, "last_price"),
        "volume": volume(m),
        "volume_24h": count(m, "volume_24h"),
        "open_interest": count(m, "open_interest"),
        "status": m.get("status") if isinstance(m.get("status"), str) else None,
        "close_time": m.get("close_time"),
        "url": url(series),
        "source": "Kalshi",
    }


_QUOTE_KEYS = ("ticker", "event_ticker", "title", "yes_sub_title", "yes_bid", "yes_ask", "no_ask",
               "yes_bid_dollars", "yes_ask_dollars", "no_ask_dollars")


def slim(m, title=None):
    """Only what a combo leg needs from a market (the crawl keeps one per open market: memory stays small)."""
    q = {k: m[k] for k in _QUOTE_KEYS if k in m}
    if title and not q.get("title"):
        q["title"] = title
    return q


def combo_row(m, by_ticker):
    legs = m.get("mve_selected_legs") or []
    out = []
    for leg in legs:
        q = by_ticker.get(leg.get("market_ticker"))
        ev = leg.get("event_ticker") or (q or {}).get("event_ticker", "")
        out.append({
            "market_ticker": leg.get("market_ticker"),
            "event_ticker": ev,
            "side": leg.get("side"),
            "title": (q or {}).get("title") or (q or {}).get("yes_sub_title") or leg.get("market_ticker"),
            "ask_cents": leg_ask(q, leg.get("side")) if q else None,
            "url": url(series_of(ev or leg.get("market_ticker", ""))),
        })
    same_event = len({leg["event_ticker"] for leg in out}) < len(out)
    asks = [leg["ask_cents"] for leg in out]
    # Same-event legs are correlated, so the simple product is wrong (docs/18 §5): no number then.
    product = None if same_event or None in asks else round(math.prod(a / 100 for a in asks) * 100, 2)
    quote = cents(m, "yes_ask")
    ev = m.get("event_ticker", "")
    return {
        "ticker": m["ticker"],
        "event_ticker": ev,
        "collection_ticker": m.get("mve_collection_ticker", ""),
        "title": m.get("yes_sub_title") or m.get("title") or m["ticker"],
        "legs": out,
        "same_event": same_event,
        "kalshi_yes_bid_cents": cents(m, "yes_bid"),
        "kalshi_yes_ask_cents": quote,
        "legs_product_cents": product,
        "price_basis": "kalshi_quote" if quote is not None else "legs_product",
        "volume": volume(m),
        "close_time": m.get("close_time"),
        "url": url(series_of(ev)),
        "source": "Kalshi",
    }


def crawl(client, deadline=None):
    """Every open event, page by page. Returns (markets, by_ticker, info). Stops cleanly at the deadline, at
    MAX_PAGES or on a repeated cursor (`complete` False); raises only if not even the first page came back."""
    client.deadline = deadline
    markets, by_ticker = [], {}
    info = {"pages": 0, "events": 0, "complete": False, "stopped": None}
    cursor, seen = None, set()
    while info["pages"] < MAX_PAGES:
        params = {"status": "open", "with_nested_markets": "true", "limit": PAGE}
        if cursor:
            params["cursor"] = cursor
        try:
            page = client.get("/events", **params)
        except Exception as e:  # noqa: BLE001 — keep what we have; the first page failing is fatal below
            if not info["pages"]:
                raise
            info["stopped"] = f"{type(e).__name__}: {e}"
            break
        info["pages"] += 1
        for ev in page.get("events") or []:
            info["events"] += 1
            series = ev.get("series_ticker") or series_of(ev.get("event_ticker", ""))
            for m in ev.get("markets") or []:
                by_ticker[m["ticker"]] = slim(m, ev.get("title"))
                markets.append(market_row(m, ev.get("title"), series))
        cursor = page.get("cursor")
        if not cursor:
            info["complete"] = True
            break
        if cursor in seen:
            info["stopped"] = "repeated cursor"
            break
        seen.add(cursor)
    else:
        info["stopped"] = f"page limit {MAX_PAGES}"
    return markets, by_ticker, info


def combos_of(client, by_ticker, deadline=None):
    client.deadline = deadline
    raw = client.get("/markets", status="open", mve_filter="only", limit=PAGE).get("markets") or []
    raw = [m for m in raw if 2 <= len(m.get("mve_selected_legs") or []) <= MAX_LEGS][:MAX_COMBOS]
    missing = sorted({leg["market_ticker"] for m in raw for leg in m["mve_selected_legs"]} - by_ticker.keys())
    for i in range(0, len(missing), TICKER_BATCH):
        for m in client.get("/markets", tickers=",".join(missing[i:i + TICKER_BATCH])).get("markets") or []:
            by_ticker[m["ticker"]] = slim(m)
    combos = [combo_row(m, by_ticker) for m in raw]
    return [c for c in combos if c["kalshi_yes_ask_cents"] is not None or c["legs_product_cents"] is not None]


def settle(client, known, open_tickers, now, deadline=None):
    """Ask Kalshi about tickers we saw open that have since closed. A market counts as settled when its `result` is
    "yes" or "no" (its `status` is passed through as Kalshi sends it). Mutates `known` (settled and given-up
    tickers leave it); returns the new settlement rows."""
    client.deadline = deadline
    # least recently asked first, then oldest close: a backlog of unresolved tickers can't starve newer ones
    due = sorted((t for t, k in known.items() if t not in open_tickers and (epoch(k.get("close_time")) or 0) <= now),
                 key=lambda t: (known[t].get("asked_at") or 0, epoch(known[t].get("close_time")) or 0))[:SETTLE_PER_RUN]
    rows = []
    try:
        for i in range(0, len(due), TICKER_BATCH):
            for m in client.get("/markets", tickers=",".join(due[i:i + TICKER_BATCH])).get("markets") or []:
                k = known.get(m.get("ticker"))
                if k is None or m.get("result") not in ("yes", "no"):
                    continue
                rows.append({
                    "ticker": m["ticker"], "event_ticker": k.get("event_ticker", ""), "title": k.get("title", ""),
                    "subtitle": k.get("subtitle", ""), "result": m["result"],
                    "status": m.get("status") if isinstance(m.get("status"), str) else None,
                    "close_time": m.get("close_time") or k.get("close_time"), "settled_seen_at": int(now),
                    "url": url(k.get("series_ticker") or series_of(k.get("event_ticker", ""))), "source": "Kalshi",
                })
                known.pop(m["ticker"], None)
    finally:
        for t in due:   # no result a month after the close: stop asking
            k = known.get(t)
            if k is not None:
                k["asked_at"] = int(now)
            if k is not None and now - (epoch(k.get("close_time")) or 0) > SETTLE_GIVE_UP_S:   # no close time: ask once
                known.pop(t, None)
    return rows


def _read(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def state_paths(cache_dir):
    """Kept next to the cache, not in it (the cache prune only touches <sha1>.json, but keep them apart anyway)."""
    base = os.path.dirname(os.path.abspath(cache_dir))
    return {"known": os.path.join(base, "kalshi_known.json"), "history": os.path.join(base, "kalshi_settled.jsonl"),
            "dump": os.path.join(base, "kalshi_markets.json")}


def build(client, state=None, prev=None, now=None, budget=BUDGET_S):
    """kalshi.json from a crawl. `state` = state_paths(); None = no settlements, no dump (tests). `prev` = the last
    kalshi.json (its recent settlements carry over)."""
    t0 = time.time() if now is None else now
    deadline = t0 + budget
    notes = []
    markets, by_ticker, info = crawl(client, t0 + budget * CRAWL_SHARE)
    if info["stopped"]:
        notes.append(f"crawl stopped: {info['stopped']}")

    try:
        combos = combos_of(client, by_ticker, deadline)
    except Exception as e:  # noqa: BLE001 — markets still publish
        combos = []
        notes.append(f"combos skipped: {type(e).__name__}: {e}")
    del by_ticker

    new_settled = []
    if state is not None:
        known = _read(state["known"], {})
        for m in markets:
            known[m["ticker"]] = {k: m[k] for k in ("event_ticker", "series_ticker", "title", "subtitle", "close_time")}
        try:
            new_settled = settle(client, known, {m["ticker"] for m in markets}, t0, deadline)
        except Exception as e:  # noqa: BLE001
            notes.append(f"settlements skipped: {type(e).__name__}: {e}")
        _write(state["known"], known)
        if new_settled:
            os.makedirs(os.path.dirname(state["history"]), exist_ok=True)
            with open(state["history"], "a") as f:
                f.writelines(json.dumps(r) + "\n" for r in new_settled)
        _write(state["dump"], {"fetched_at": int(getattr(client, "oldest", None) or t0), "complete": info["complete"], "markets": markets})

    fresh = {r["ticker"] for r in new_settled}
    carried = [r for r in (prev or {}).get("settled") or []
               if r.get("ticker") not in fresh and t0 - (r.get("settled_seen_at") or 0) <= SETTLED_KEEP_S]
    settled = (new_settled + carried)[:SETTLED_MAX]

    # A crawl cut short (time budget, a failed page) must not replace a fuller recent file with a fraction of it: keep
    # the last complete crawl's other markets for up to KEEP_FULL_S, and say so (fetched_at = the older of the two).
    fetched_at = int(getattr(client, "oldest", None) or t0)
    crawled = len(markets)
    pm = (prev or {}).get("meta") or {}
    complete_at = fetched_at if info["complete"] else pm.get("complete_at")
    if (not info["complete"] and complete_at and t0 - complete_at <= KEEP_FULL_S
            and crawled < 0.8 * (pm.get("n_markets_open") or 0)):
        seen = {m["ticker"] for m in markets}
        kept = [m for m in (prev or {}).get("markets") or []
                if m.get("ticker") not in seen and (epoch(m.get("close_time")) or math.inf) > t0]
        markets += kept
        fetched_at = min(fetched_at, int(pm.get("fetched_at") or fetched_at))
        notes.append(f"partial crawl: kept {len(kept)} markets from the last complete crawl")

    markets.sort(key=lambda m: m["volume"], reverse=True)
    return {
        "meta": {
            "source": "Kalshi",
            "attribution": "Market data from Kalshi (kalshi.com)",
            "fetched_at": fetched_at,
            "complete_at": complete_at,
            "api": BASE,
            "n_markets": min(len(markets), KEEP_MARKETS),
            "n_markets_open": crawled,
            "n_events": info["events"],
            "complete": info["complete"],
            "n_combos": len(combos),
            "n_settled": len(settled),
            "pages": info["pages"],
            "notes": notes,
        },
        "markets": markets[:KEEP_MARKETS],
        "combos": combos,
        "settled": settled,
    }


def run(out_path, cache_dir, client=None, now=None, budget=BUDGET_S):
    c = client or Client(cache_dir)
    t0 = time.time()
    state = state_paths(cache_dir)
    data = build(c, state, _read(out_path, None), now=now, budget=budget)
    data["meta"]["seconds"] = round(time.time() - t0, 1)
    _write(out_path, data)
    if hasattr(c, "prune"):
        c.prune()
    return data


def run_if_enabled(out_path, cache_dir, log=print):
    """Engine scan hook: no-op (and no network) unless KALSHI_DATA_PERMISSION=true; a Kalshi failure never fails the scan."""
    if not enabled():
        return None
    try:
        data = run(out_path, cache_dir)
        m = data["meta"]
        log(f"kalshi: {m['n_markets_open']} markets ({m['n_events']} events, {m['pages']} pages, complete={m['complete']}), "
            f"{m['n_combos']} combos, {m['n_settled']} settled, {m['seconds']}s"
            + (f"; {'; '.join(m['notes'])}" if m["notes"] else ""))
        return data
    except Exception as e:  # noqa: BLE001 — optional source; the main scan must still publish
        log(f"kalshi: skipped ({e})")
        return None
