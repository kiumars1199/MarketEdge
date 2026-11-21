"""Shared config: API hosts, categories, fee model, HTTP helper."""
import json
import time
from datetime import datetime, timezone

import requests

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"

# Tag slugs we sample closed events from (Polymarket Gamma `tag_slug`).
SAMPLE_TAGS = [
    "nba", "nfl", "mlb", "nhl", "cfb", "soccer", "tennis", "esports", "sports",
    "ncaa-basketball", "ufc", "boxing", "golf", "f1", "formula1", "cricket",
    "politics", "elections", "geopolitics", "world",
    "crypto", "xrp", "finance", "economy", "tech", "pop-culture", "weather",
]

# Live Polymarket tag slug -> our niche name, applied before classifying.
TAG_ALIASES = {"cbb": "ncaab", "ncaa-basketball": "ncaab", "college-basketball": "ncaab",
               "mma": "ufc", "formula1": "f1"}

# tag slug -> top-level category, checked in this priority order.
CATEGORY_PRIORITY = [
    ("sports", {"sports", "nba", "nfl", "mlb", "nhl", "cfb", "soccer", "tennis", "esports", "games",
                "ncaab", "ufc", "boxing", "golf", "f1", "cricket"}),
    ("crypto", {"crypto", "crypto-prices", "bitcoin", "ethereum", "solana", "xrp"}),
    ("weather", {"weather"}),
    ("tech", {"tech", "ai"}),
    ("finance", {"finance", "stocks", "fed", "economy"}),
    ("culture", {"pop-culture", "culture", "movies", "music"}),
    ("geopolitics", {"geopolitics", "world"}),
    ("politics", {"politics", "elections", "us-politics"}),
]

# Niche = the most specific known tag, shown as a filter in the UI.
NICHE_TAGS = ["nba", "nfl", "mlb", "nhl", "cfb", "ncaab", "soccer", "tennis", "ufc", "boxing",
              "golf", "f1", "cricket", "esports", "elections", "bitcoin", "ethereum", "solana", "xrp",
              "weather", "fed", "economy"]

# Polymarket taker fee rate by category (docs.polymarket.com/trading/fees).
# fee per share = rate * p * (1 - p). Makers pay 0.
FEE_RATE = {
    "crypto": 0.07, "sports": 0.05, "finance": 0.04, "politics": 0.04,
    "culture": 0.05, "weather": 0.05, "tech": 0.04, "geopolitics": 0.0,
    "other": 0.05,
}

HORIZONS_H = [1, 6, 24, 72, 168]  # hours before resolution


def taker_fee(category, p):
    return FEE_RATE.get(category, 0.05) * p * (1 - p)


def classify(tag_slugs):
    s = {TAG_ALIASES.get(t, t) for t in tag_slugs}
    cat = "other"
    for name, slugs in CATEGORY_PRIORITY:
        if s & slugs:
            cat = name
            break
    niche = next((t for t in NICHE_TAGS if t in s), cat)
    return cat, niche


def parse_ts(v):
    if not v:
        return None
    v = v.replace(" ", "T")
    if v.endswith("+00"):
        v += ":00"
    v = v.replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(v)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


_session = requests.Session()


def http(method, url, tries=6, **kw):
    kw.setdefault("timeout", 60)
    for i in range(tries):
        try:
            r = _session.request(method, url, **kw)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** i)
                continue
            raise RuntimeError(f"{r.status_code} {url} {r.text[:200]}")
        except (requests.ConnectionError, requests.Timeout):
            time.sleep(2 ** i)
    raise RuntimeError(f"gave up: {url}")


def jl_write(path, rows):
    with open(path, "a") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def jl_read(path):
    try:
        out = []
        with open(path) as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass  # half-written last line while a fetch is still appending
        return out
    except FileNotFoundError:
        return []
