#!/usr/bin/env python3
"""RT-04: the signed-out "3 exact reveals a day" allowance lives only in a cookie the client controls.
Usage: python3 -I reveal_reset.py http://localhost:3400 [n]"""
import http.cookiejar, json, sys, urllib.request

base, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8
ids = [r["market"]["id"] for r in json.load(urllib.request.urlopen(f"{base}/api/markets?g=0&s=roi.desc"))["rows"][:n]]


def show(opener, mid):
    d = json.load(opener.open(f"{base}/api/markets/{mid}?detail=1"))
    b = d["market"]["best"]
    return f"{mid} roi={b['roi_pct']} win={b['win_prob']} {'banded' if 'ranges' in b else 'EXACT'} reveals_left={d.get('reveals_left')}"


jar = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
print("-- honest browser (keeps the me_reveals cookie)")
for i in ids:
    print(show(jar, i))
print("-- same markets, cookie dropped on every request")
for i in ids:
    print(show(urllib.request.build_opener(), i))
