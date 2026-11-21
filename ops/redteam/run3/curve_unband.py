#!/usr/bin/env python3
"""RT3: Free un-bands the exact win chance / edge / return from data Free is already sent.

/api/markets/<id> (no ?detail=1, so no reveal is spent) returns, for Free, the banded `best` side but also the exact
`mid`, `ask`, `fee` and the market's own model `curve` (lib/data/respond.ts marketBody). Linear interpolation of the
curve at `mid` reproduces the exact `win_prob`; edge = win_prob - ask - fee; roi = edge / (ask + fee).
Mode "detail" (default): /api/markets/<id> already carries the curve.
Mode "list": only the Free list rows (/api/flags) plus the public /api/model/curve: the row keeps niche, market_type,
category, horizon_h, best.model_level and best.mid, so the segment (lib/data/model.ts segmentOf) is computable.
Usage: curve_unband.py <base> <free_cookie_jar|-> <pro_cookie_jar> <market_id> [<market_id> ...]
       curve_unband.py <base> <free_cookie_jar|-> <pro_cookie_jar> --list
"""
import urllib.parse
import json, sys, urllib.request

def get(base, jar, path):
    """GET with the cookies from a curl jar (#HttpOnly_ lines included; http.cookiejar skips those)."""
    h = {}
    if jar != "-":
        kv = []
        for line in open(jar):
            if line.startswith("#HttpOnly_"): line = line[len("#HttpOnly_"):]
            elif line.startswith("#") or not line.strip(): continue
            f = line.rstrip("\n").split("\t")
            if len(f) == 7: kv.append(f"{f[5]}={f[6]}")
        h["Cookie"] = "; ".join(kv)
    return json.load(urllib.request.urlopen(urllib.request.Request(base + path, headers=h)))

def interp(points, p):
    pts = sorted((q["price"], q["win_prob"]) for q in points)
    if p <= pts[0][0]: return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= p <= x1: return y0 + (y1 - y0) * (p - x0) / (x1 - x0)
    return pts[-1][1]

def segment(m, s):
    return {"nmt": f"{m['niche']}:{m['market_type']}", "niche": m["niche"], "cat": f"cat:{m['category']}"}.get(s["model_level"], "all")

base, free, pro, ids = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
ok = 0
if ids == ["--list"]:
    rows = get(base, free, "/api/flags")["rows"]
    curves = {}
    for r in rows:
        m, s = r["market"], r["market"]["best"]
        key = (segment(m, s), m["horizon_h"])
        if key not in curves:
            curves[key] = get(base, free, "/api/model/curve?" + urllib.parse.urlencode({"segment": key[0], "h": key[1]}))
        w = interp(curves[key]["points"], s["mid"]); edge = w - s["ask"] - s["fee"]
        x = get(base, pro, f"/api/markets/{m['id']}")["market"]["best"]
        good = abs(w - x["win_prob"]) < 0.005
        ok += good
        print(f"{m['id']}: list row win {s['win_prob']:.2f} edge {s['edge']:.2f} | derived win {w:.4f} edge {edge:+.4f} | pro exact win {x['win_prob']:.4f} edge {x['edge']:+.4f} {'MATCH' if good else 'off'}")
    print(f"{ok}/{len(rows)} within 0.5 pp using {len(curves)} curve calls")
    sys.exit(0)
for mid in ids:
    f = get(base, free, f"/api/markets/{mid}")
    s, c = f["market"]["best"], f.get("curve")
    if not c: print(mid, "no curve"); continue
    w = interp(c["points"], s["mid"]); edge = w - s["ask"] - s["fee"]
    x = get(base, pro, f"/api/markets/{mid}")["market"]["best"]
    good = abs(w - x["win_prob"]) < 0.005
    ok += good
    print(f"{mid}: free shown win {s['win_prob']:.2f} edge {s['edge']:.2f} | derived win {w:.4f} edge {edge:+.4f} | pro exact win {x['win_prob']:.4f} edge {x['edge']:+.4f} {'MATCH' if good else 'off'}")
print(f"{ok}/{len(ids)} within 0.5 pp")
