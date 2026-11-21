"""Kismet engine: a recency-weighted, hierarchical calibration model for prediction markets.

One config file = one instance. Commands (run from repo root):
    python -m engine --config config/demo.json update     # pull newly resolved markets + prices
    python -m engine --config config/demo.json fit        # refit model -> output/model.json
    python -m engine --config config/demo.json backtest   # walk-forward test, tunes half-life
    python -m engine --config config/demo.json scan       # score open markets -> output/*.json
    python -m engine --config config/demo.json all        # update + fit + scan
    python -m engine --config config/demo.json grade      # grade resolved flags in output/ledger.jsonl
"""
