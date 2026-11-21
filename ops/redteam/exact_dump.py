#!/usr/bin/env python3
"""RT-01 chain: ids from bulk_scrape.py's output -> /api/markets/<id>?detail=1 with no cookie -> exact (Pro-shaped)
numbers for every market, anonymously. Usage: python3 -I exact_dump.py http://localhost:3400 scraped.json [threads]"""
import json, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

base, src = sys.argv[1], sys.argv[2]
threads = int(sys.argv[3]) if len(sys.argv) > 3 else 16
ids = [m["id"] for m in json.load(open(src))]
codes = {}


def one(mid):
    try:
        d = json.load(urllib.request.urlopen(f"{base}/api/markets/{mid}?detail=1"))
        return "exact" if "ranges" not in d["market"]["best"] else "banded"
    except urllib.error.HTTPError as e:
        return f"http_{e.code}"


t = time.time()
with ThreadPoolExecutor(threads) as ex:
    for r in ex.map(one, ids):
        codes[r] = codes.get(r, 0) + 1
print(json.dumps({"ids": len(ids), "results": codes, "seconds": round(time.time() - t, 1)}))
