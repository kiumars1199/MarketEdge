"""Grade the ledger rows that were still open when the `live` branch was published, read-only, from Polymarket's
public Gamma API, with the engine's own rule (engine/ledger.grade: resolved_yes, pnl = won - ask - fee).

Rows already graded keep their result. Rows graded here get `graded_by="grade_now"` so the scripts can split
"settled by the published snapshot" (in-sample) from "settled since" (held out). Writes a new jsonl; never touches
output/ or the live branch.

    python3 scripts/ledger/grade_now.py ledger.jsonl out.jsonl cache_dir
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
from common import load  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"


def resolved_yes(m):  # pipeline/fetch_closed.resolved_yes
    try:
        prices = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
    except (ValueError, TypeError):
        return None
    if len(prices) != 2:
        return None
    if prices[0] >= 0.99 and prices[1] <= 0.01:
        return 1
    if prices[1] >= 0.99 and prices[0] <= 0.01:
        return 0
    return None


def get(cache, mid):
    p = os.path.join(cache, f"m{mid}.json")
    # cached copies from before a market closed are refetched
    if os.path.exists(p):
        m = json.load(open(p))
        if m.get("closed") and resolved_yes(m) is not None:
            return m
    for i in range(4):
        try:
            req = urllib.request.Request(f"{GAMMA}/markets/{mid}", headers={"user-agent": "ledger-research"})
            with urllib.request.urlopen(req, timeout=30) as r:
                m = json.load(r)
            json.dump(m, open(p, "w"))
            return m
        except Exception:  # noqa: BLE001
            time.sleep(1 + i)
    return None


def main(src, dst, cache):
    os.makedirs(cache, exist_ok=True)
    rows = load(src)
    open_ids = sorted({e["id"] for e in rows if "result" not in e})
    with ThreadPoolExecutor(6) as ex:
        mk = dict(zip(open_ids, ex.map(lambda i: get(cache, i), open_ids)))
    n = 0
    now = int(time.time())
    for e in rows:
        if "result" in e:
            continue
        m = mk.get(e["id"])
        y = resolved_yes(m) if m and m.get("closed") else None
        if y is None:
            continue
        won = (y == 1) if e["side_index"] == 0 else (y == 0)
        e.update(result="won" if won else "lost", pnl=round(int(won) - e["ask"] - e["fee"], 4),
                 graded_at=now, graded_by="grade_now")
        n += 1
    with open(dst, "w") as f:
        for e in rows:
            f.write(json.dumps(e) + "\n")
    print(f"open rows {sum(1 for e in rows if 'result' not in e) + n}, graded now {n}, still open "
          f"{sum(1 for e in rows if 'result' not in e)}; wrote {dst}")


if __name__ == "__main__":
    main(*sys.argv[1:])
