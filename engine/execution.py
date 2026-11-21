"""Execution check: is the edge still there at the price you'd actually pay?

The model estimates a win probability q from the MID price. But a market order
pays the ASK, walks down the order book as size grows, and pays a taker fee.
For every flagged market this module reads the live order book and answers:

  gross_edge     = q - mid                       edge if you could trade at mid
  spread_cost    = ask - mid                     what crossing the spread costs
  net_edge       = q - ask - fee(ask)            edge on the first share
  retention      = net_edge / gross_edge         share of the edge that survives
  stake table    = for $25 / $100 / $500 / $1000: average fill price, edge, ROI
  capacity_usd   = dollars you can buy before the next share's edge < min_edge
  limit_edge     = q - (best bid + 1 tick)       edge if a limit order fills (no fee)
  verdict        = "worth it" | "thin" | "not worth it"

So a market is only "worth it" when crossing the spread doesn't eat the edge:
if the ask sits as far above mid as the model's edge, Kismet adds nothing.
"""
import json

from pipeline.common import CLOB, http

STAKES = [25, 100, 500, 1000]


def _levels(book, side):
    """Order book levels best-first as (price, size) floats."""
    lv = [(float(x["price"]), float(x["size"])) for x in book.get(side) or []]
    return sorted(lv, key=lambda x: x[0], reverse=(side == "bids"))


def fill(asks, dollars, fee_rate):
    """Market-buy `dollars` worth (including fee). Returns shares, avg price, avg fee."""
    shares = cost = fees = 0.0
    left = dollars
    for price, size in asks:
        fee = fee_rate * price * (1 - price)
        per_share = price + fee
        take = min(size, left / per_share)
        if take <= 0:
            break
        shares += take
        cost += take * price
        fees += take * fee
        left -= take * per_share
        if left <= 1e-9:
            break
    if shares == 0:
        return None
    return dict(shares=shares, avg_price=cost / shares, avg_fee=fees / shares, filled_usd=dollars - left)


def capacity(asks, q, fee_rate, min_edge):
    """Dollars spendable while each marginal share still has edge >= min_edge."""
    usd = 0.0
    for price, size in asks:
        fee = fee_rate * price * (1 - price)
        if q - price - fee < min_edge:
            break
        usd += size * (price + fee)
    return usd


def check(q, book, fee_rate, min_edge, tick=0.01):
    asks, bids = _levels(book, "asks"), _levels(book, "bids")
    if not asks:
        return dict(verdict="no sellers", book_ok=False)
    best_ask = asks[0][0]
    best_bid = bids[0][0] if bids else None
    mid = (best_ask + best_bid) / 2 if best_bid is not None else best_ask
    fee = fee_rate * best_ask * (1 - best_ask)
    gross = q - mid
    net = q - best_ask - fee
    retention = net / gross if gross > 0 else 0.0
    stakes = []
    for usd in STAKES:
        f = fill(asks, usd, fee_rate)
        if not f:
            continue
        e = q - f["avg_price"] - f["avg_fee"]
        stakes.append(dict(stake_usd=usd, filled_usd=round(f["filled_usd"], 2),
                           shares=round(f["shares"], 2), avg_price=round(f["avg_price"], 4),
                           edge=round(e, 4),
                           expected_profit_usd=round(e * f["shares"], 2),
                           roi_pct=round(e / (f["avg_price"] + f["avg_fee"]) * 100, 2)))
    limit_price = round(min(best_ask - tick, (best_bid or 0) + tick), 4)
    if net >= min_edge and retention >= 0.5:
        verdict = "worth it"
    elif net > 0:
        verdict = "thin"
    else:
        verdict = "not worth it"
    return dict(book_ok=True, best_bid=best_bid, best_ask=best_ask, book_mid=round(mid, 4),
                spread=round(best_ask - (best_bid or best_ask), 4), spread_cost=round(best_ask - mid, 4),
                fee_at_ask=round(fee, 4), gross_edge=round(gross, 4), net_edge=round(net, 4),
                retention=round(retention, 3), capacity_usd=round(capacity(asks, q, fee_rate, min_edge), 2),
                stakes=stakes, limit_price=limit_price, limit_edge=round(q - limit_price, 4),
                verdict=verdict)


def books(token_ids):
    out = {}
    for i in range(0, len(token_ids), 100):
        chunk = token_ids[i:i + 100]
        for b in http("POST", f"{CLOB}/books", json=[{"token_id": t} for t in chunk]) or []:
            out[b.get("asset_id")] = b
    return out


def enrich(cfg, rows, fee_rates, log=print):
    """Adds `execution` to each row's best side, from the live order book."""
    want = []
    for r in rows:
        tok = (r.get("tokens") or [None, None])[r["best"]["side_index"]]
        if tok:
            want.append(tok)
    bk = books(want)
    for r in rows:
        tok = (r.get("tokens") or [None, None])[r["best"]["side_index"]]
        b = bk.get(tok)
        if not b:
            r["execution"] = dict(verdict="no book", book_ok=False, ask_size=None, bid_size=None)
            continue
        r["execution"] = check(r["best"]["win_prob"], b, fee_rates.get(r["category"], 0.05),
                               cfg.flag_min_edge)
        # size (shares) at the best ask / best bid of the best side's book; kept out of
        # check() so its output stays the TS-port contract (fixtures/book_expected.json)
        for side, key in (("asks", "ask_size"), ("bids", "bid_size")):
            lv = _levels(b, side)
            r["execution"][key] = lv[0][1] if lv else None
    log(f"order books checked: {len(bk)}")
    return rows
