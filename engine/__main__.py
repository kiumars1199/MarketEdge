import argparse
import json
import os
import sys
import time

from . import backtest, config, dataset, precompute, scan, update
from .model import Model


def fit(cfg, log=print):
    b = dataset.load(cfg)
    hl = cfg.half_life_days
    bt_p = cfg.path("output", "backtest.json")
    try:  # use the half-life the latest walk-forward test picked, if any
        hl = json.load(open(bt_p)).get("chosen_half_life_days", hl)
    except FileNotFoundError:
        pass
    asof = time.time()
    m = Model(cfg, b.vocab, hl).fit(b, asof=asof)
    out = m.to_json()
    out.update(instance=cfg.instance, fitted_at=int(asof), data=dataset.summary(b))
    json.dump(out, open(cfg.path("output", "model.json"), "w"))
    log(f"model fitted: half-life={hl or 'no decay'} nodes={len(m.nodes)} bets={b.n}")


def run_backtest(cfg, log=print):
    b = dataset.load(cfg)
    bt = backtest.run(cfg, b, log=log)
    found, hl = backtest.pick_half_life(bt)
    bt["chosen_half_life_days"] = hl if found else cfg.half_life_days
    bt["combos"] = bt.pop("combos_by_half_life").get(str(bt["chosen_half_life_days"]), {})
    bt["data"] = dataset.summary(b)
    bt["ran_at"] = int(time.time())
    json.dump(bt, open(cfg.path("output", "backtest.json"), "w"), indent=1)
    log(f"chosen half-life: {bt['chosen_half_life_days']}")


DELAYED = ("markets.json", "flags.json") + precompute.FILES  # T-295: top.json / counts.json rotate with the scan


def scan_keeping_prev(cfg, run=None):
    """Scan, then keep the two scans before it: the replaced one as *-prev.json, the one before that as
    *-prev2.json. The Free tier is served the newest scan at least the delay old (docs/15; the web store picks).
    Two copies, not one (RT3-03): at a 10-minute cadence the replaced scan is only ~10 min old, so a single copy
    either breaks the 15-min delay or leaves Free with nothing for 5 minutes of every 10. Same shift as
    ops/upload.py (Storage) and refresh.yml (live branch)."""
    old = {}
    for name in DELAYED:
        for src in (name, name.replace(".json", "-prev.json")):
            try:
                with open(cfg.path("output", src), "rb") as f:
                    old[src] = f.read()
            except FileNotFoundError:
                pass
    (run or scan.run)(cfg)  # a failed scan raises: nothing rotated, the old files stay as they were
    precompute.write(os.path.dirname(cfg.path("output", "flags.json")))  # T-295: top.json, top-<category>.json, counts.json
    for src, data in old.items():
        with open(cfg.path("output", src.replace(".json", "-prev.json").replace("-prev-prev", "-prev2")), "wb") as f:
            f.write(data)


def main():
    ap = argparse.ArgumentParser(prog="python -m engine")
    ap.add_argument("--config", default="config/demo.json")
    ap.add_argument("cmd", choices=["update", "fit", "backtest", "scan", "all", "grade"])
    a = ap.parse_args()
    cfg = config.load(a.config)
    if a.cmd in ("update", "all"):
        update.run(cfg)
    if a.cmd == "backtest":
        run_backtest(cfg)
    if a.cmd in ("fit", "all"):
        fit(cfg)
    if a.cmd in ("scan", "all"):
        scan_keeping_prev(cfg)
        __import__("pipeline.fetch_kalshi").fetch_kalshi.run_if_enabled(cfg.path("output", "kalshi.json"), cfg.path("data", "kalshi_cache"))  # no-op unless KALSHI_DATA_PERMISSION=true
    if a.cmd == "grade":
        from . import ledger
        ledger.grade(cfg)


if __name__ == "__main__":
    sys.exit(main())
