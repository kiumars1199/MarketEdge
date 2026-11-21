#!/usr/bin/env python3
"""RT-02: anonymous bulk scrape of the whole scan, 25 rows at a time, by splitting the price range until each
window holds <= 25 markets (Free gets page 1 only, but every filter combination is a fresh page 1).
Usage: python3 -I bulk_scrape.py http://localhost:3400 [out.json]"""
import json, sys, time, urllib.parse, urllib.request

base = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else None
seen, calls, statuses = {}, 0, {}
CATS = ["sports", "crypto", "politics", "finance", "culture", "weather", "tech", "geopolitics", "other"]


def get(params):
    global calls
    calls += 1
    url = f"{base}/api/markets?" + urllib.parse.urlencode({"g": "0", "wp": "0", "s": "price.asc", **params})
    try:
        with urllib.request.urlopen(url) as r:
            statuses[r.status] = statuses.get(r.status, 0) + 1
            return json.load(r)
    except urllib.error.HTTPError as e:
        statuses[e.code] = statuses.get(e.code, 0) + 1
        return None


def hours(base_params, a, b, depth=0):
    # second axis when many markets share one price: closes_after_h (ca) / closes_within_h (cw)
    d = get({**base_params, "ca": repr(a), "cw": repr(b)})
    if not d:
        return
    for r in d["rows"]:
        seen[r["market"]["id"]] = r["market"]
    if d["total"] > len(d["rows"]) and depth < 25 and b - a > 0.01:
        m = (a + b) / 2
        hours(base_params, a, m, depth + 1)
        hours(base_params, m, b, depth + 1)


def window(cat, lo, hi, depth=0):
    d = get({"c": cat, "p0": repr(lo), "p1": repr(hi)})
    if not d:
        return
    for r in d["rows"]:
        seen[r["market"]["id"]] = r["market"]
    if d["total"] > len(d["rows"]) and depth < 30 and hi - lo > 1e-6:
        mid = (lo + hi) / 2
        window(cat, lo, mid, depth + 1)
        window(cat, mid, hi, depth + 1)
    elif d["total"] > len(d["rows"]):
        hours({"c": cat, "p0": repr(lo), "p1": repr(hi)}, 0.0, 24.0 * 400)


t = time.time()
for c in CATS:
    window(c, 0.0, 1.0)
total = json.load(urllib.request.urlopen(f"{base}/api/markets?wp=0&g=0"))["total"]
print(json.dumps({"markets_scraped": len(seen), "reported_total": total, "requests": calls, "http_status": statuses,
                  "seconds": round(time.time() - t, 1)}))
if out:
    json.dump(list(seen.values()), open(out, "w"))
