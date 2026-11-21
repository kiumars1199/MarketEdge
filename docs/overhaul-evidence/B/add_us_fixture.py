"""Add Polymarket US quotes (`us`) to some fixture sports best bets, additively (T-302, docs/OVERHAUL.md §G).

Deterministic: picks sports best-tier flags of the kinds Polymarket US lists (moneyline, totals, spreads, period
moneylines), prices them near the international ask with the US fee (0.095 * p * (1 - p)), and makes a few of them
fall under min_edge at US prices and one "listed, no live book" (ask null), so tests cover every case.
"""
import json
import sys
import zlib

root = sys.argv[1]
THETA = 0.095


def pick(m):
    if m["category"] != "sports" or m.get("tier", "best") != "best":
        return False
    q = m["question"]
    if q.startswith("Exact Score") or "Both Teams" in q:
        return False
    return m["market_type"] in ("moneyline", "totals", "spreads") or "Moneyline" in q


def quote(m, i):
    s = m["best"]
    h = zlib.crc32(m["id"].encode()) % 3 - 1          # -1, 0, +1 cent
    slug = f"aec-{m['niche']}-{m['id']}"
    q = {"slug": slug, "url": f"https://polymarket.us/event/{slug}", "side": s["side_index"]}
    if i == 7:                                        # listed on US, no live book
        return {**q, "ask": None, "fee": None, "edge": None, "roi_pct": None}
    ask = round(s["ask"] + h / 100, 2)
    if i % 6 == 5:                                    # every 6th: too dear on US (edge under min_edge after the fee)
        ask = round(s["win_prob"] - 0.01, 2)
    fee = round(THETA * ask * (1 - ask), 4)
    edge = round(s["win_prob"] - ask - fee, 4)
    return {**q, "ask": ask, "fee": fee, "edge": edge, "roi_pct": round(edge / (ask + fee) * 100, 2)}


flags = json.load(open(f"{root}/flags.json"))
markets = json.load(open(f"{root}/markets.json"))
chosen = {}
for m in flags["flags"]:
    if pick(m):
        chosen[m["id"]] = quote(m, len(chosen))
# like engine/scan.py attach_us: every row gets `us`, None when the market isn't listed on Polymarket US
for m in flags["flags"]:
    m["us"] = chosen.get(m["id"], m.get("us"))
for m in markets["markets"]:
    m["us"] = chosen.get(m["id"], m.get("us"))
priced = [q for q in chosen.values() if q["edge"] is not None]
us_meta = {"ok": True, "markets": 82000, "matched": len(chosen), "best_on_us": len(chosen),
           "best_us_edge": sum(1 for q in priced if q["edge"] >= flags["meta"]["rule"]["min_edge"])}
flags["meta"]["us"] = us_meta
markets["meta"]["us"] = us_meta
for name, d in (("flags.json", flags), ("markets.json", markets)):
    with open(f"{root}/{name}", "w") as f:
        json.dump(d, f)
print(len(chosen), us_meta)
