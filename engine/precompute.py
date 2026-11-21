"""Small precomputed files written after each scan, next to markets.json (T-295, docs/03 § top.json / counts.json).

  top.json             Best bets candidates: flags.json rows on the Best bets list (tier best, price check "worth it"
                       or "thin", best side at or above the 40% chance floor, open at scan time), sorted like the page
                       (estimated return high to low, then closing soonest, then id). Each row is ApiRow-shaped:
                       {"market": <the flags.json row>, "side": <its best side>}. Exact numbers: the web server applies
                       the Free gating (lib/data/gate.ts) and re-runs the page's own query on these rows
                       (apps/web lib/data/top.ts), so this list only has to be a superset of what any Best bets view
                       built from it shows. A few KB per row; a few hundred rows instead of ~35 MB of markets + flags.
  top-<category>.json  the same rows, one file per category (sports, crypto, ...), only categories with rows.
  counts.json          the scan's meta (flags.json meta: rule, instance, ...) and every count the site shows, at scan
                       time: markets scanned, flags by tier and price check, Best
                       bets total, by price check and by category. The web re-counts rows at the request clock (a
                       market can close after the scan), so pages that list bets count from top.json, never mix both.

Pure functions plus write(); scan_keeping_prev (engine/__main__.py) calls write() after every scan.
"""
import json
import os

# Mirrors apps/web lib/filters/state.ts (BEST_BETS_VERDICTS, win_prob_floor_default) and lib/data/counts.ts
# bestBetsQuery. apps/web test/top.test.ts fails if this list ever drops a row the web's own query keeps.
BEST_BETS_VERDICTS = ("worth it", "thin")
WIN_PROB_FLOOR = 0.4
CATEGORIES = ("sports", "crypto", "politics", "finance", "culture", "weather", "tech", "geopolitics", "other")
FILES = ("top.json", "counts.json")  # rotated to *-prev.json / *-prev2.json like markets.json and flags.json


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x


def on_list(r, now):
    """True when a flags.json row is on the unfiltered Best bets list at `now` (unix s)."""
    best, ex = r.get("best") or {}, r.get("execution") or {}
    return ((r.get("tier") or "best") == "best" and ex.get("verdict") in BEST_BETS_VERDICTS
            and _num(best.get("win_prob")) and best["win_prob"] >= WIN_PROB_FLOOR
            and _num(r.get("closes_at")) and r["closes_at"] > now)


def us_active(meta):
    """Mirrors apps/web lib/filters/us.ts usActive: the "On Polymarket US" default bites only when the scan priced US."""
    return (meta.get("us") or {}).get("ok") is True


def on_us(r, min_edge):
    """Mirrors lib/filters/us.ts onUs: listed on Polymarket US, priced, edge after the US fee >= min_edge (§G2)."""
    us = r.get("us") or {}
    return _num(us.get("ask")) and _num(us.get("edge")) and us["edge"] >= min_edge


def _order(r, us=False):
    roi = r["best"].get("roi_pct")
    if us and _num((r.get("us") or {}).get("roi_pct")):
        roi = r["us"]["roi_pct"]   # lib/filters/apply.ts comparator: rank by the US return when the US filter is on
    return (-(roi if _num(roi) else float("-inf")), r.get("closes_at") or 0, str(r.get("id")))


def _min_edge(meta):
    return (meta.get("rule") or {}).get("min_edge") or 0


def top_rows(flags_file):
    """Every row on the international Best bets list (a superset: the web applies the US filter itself, and Free
    falls back to the whole list when the US set is short). Ordered as the page orders them."""
    meta = flags_file.get("meta") or {}
    now = meta.get("scanned_at") or 0
    us = us_active(meta)
    rows = sorted((r for r in flags_file.get("flags") or [] if on_list(r, now)), key=lambda r: _order(r, us))
    return [{"market": r, "side": r["best"]} for r in rows]


def top_file(flags_file, rows, category=None):
    return {"meta": flags_file.get("meta") or {},
            "query": {"view": "flags", "tier": "best", "verdicts": list(BEST_BETS_VERDICTS),
                      "win_prob_min": WIN_PROB_FLOOR, "sort": "roi desc", **({"category": category} if category else {})},
            "total": len(rows), "rows": rows}


def counts(flags_file, rows, markets_meta=None):
    meta = flags_file.get("meta") or {}
    flags = flags_file.get("flags") or []
    sections = {v: 0 for v in BEST_BETS_VERDICTS}
    by_cat = {}
    if us_active(meta):   # the one Best bets count is the "On Polymarket US" set (lib/data/counts.ts bestBetsRows)
        rows = [row for row in rows if on_us(row["market"], _min_edge(meta))]
    for row in rows:
        m = row["market"]
        sections[m["execution"]["verdict"]] += 1
        by_cat[m.get("category") or "other"] = by_cat.get(m.get("category") or "other", 0) + 1
    tiers = {"best": 0, "edge": 0}
    verdicts = {}
    for r in flags:
        t = r.get("tier") or "best"
        tiers[t] = tiers.get(t, 0) + 1
        v = (r.get("execution") or {}).get("verdict")
        if v:
            verdicts[v] = verdicts.get(v, 0) + 1
    mm = markets_meta or meta
    return {"scanned_at": meta.get("scanned_at"), "meta": meta, "markets_scanned": mm.get("markets_scanned"),
            "flags": len(flags), "tiers": tiers, "verdicts": verdicts,
            "best_bets": {"total": len(rows), "sections": sections, "by_category": by_cat}}


def _dump(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)  # readers never see a half-written file


def write(out, log=print):
    """Read <out>/flags.json, write top.json, top-<category>.json and counts.json. On any error the files are removed,
    so the web falls back to markets.json + flags.json instead of serving a stale list beside a fresh scan."""
    paths = [os.path.join(out, n) for n in FILES] + [os.path.join(out, f"top-{c}.json") for c in CATEGORIES]
    try:
        with open(os.path.join(out, "flags.json")) as f:
            flags_file = json.load(f)
        rows = top_rows(flags_file)
        _dump(os.path.join(out, "top.json"), top_file(flags_file, rows))
        for c in CATEGORIES:
            sub = [r for r in rows if (r["market"].get("category") or "other") == c]
            p = os.path.join(out, f"top-{c}.json")
            if sub:
                _dump(p, top_file(flags_file, sub, c))
            elif os.path.exists(p):
                os.remove(p)
        _dump(os.path.join(out, "counts.json"), counts(flags_file, rows))
        log(f"precomputed: top.json {len(rows)} best bets, counts.json")
        return True
    except Exception as e:  # additive files: a failure here must never fail the scan
        for p in paths:
            if os.path.exists(p):
                os.remove(p)
        log(f"precompute failed, removed top/counts files (web falls back to the full files): {type(e).__name__}: {e}")
        return False


if __name__ == "__main__":
    import sys
    sys.exit(0 if write(sys.argv[1] if len(sys.argv) > 1 else "output") else 1)
