"""Step 1: pull resolved binary markets from Polymarket, sampled by category tag.

Writes data/markets.jsonl (one row per resolved binary market).
Usage: python pipeline/fetch_closed.py [--days 365] [--per-tag 2000]
  --per-tag N: the newest N closed events per tag in the last --days (0 = every one). Values above
  Gamma's offset limit (~2000) work: a busy window is split in half, never paged deeper (T-278).

Backfill mode (--window-days N): walks back in N-day end-date windows, newest first, so a
long history is sampled evenly over time instead of only the newest `per-tag` events.
Resumable: rows are appended to markets.jsonl page by page, and finished (window, tag) pairs are
checkpointed in data/fetch_closed_state.json with the cap they were fetched at. Rerun the same
command to continue; rerun with a bigger --per-window (or 0 = every event) to top up windows an
earlier run fetched at a smaller cap (already stored markets are skipped).
  python pipeline/fetch_closed.py --days 730 --window-days 30 --per-window 1000

Memory: events are streamed one page (100) at a time and rows written as they come; only the
ids already stored are held (to skip duplicates).
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from common import GAMMA, SAMPLE_TAGS, classify, http, parse_ts  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "markets.jsonl")
STATE = os.path.join(os.path.dirname(__file__), "..", "data", "fetch_closed_state.json")
DAY = 86400


def resolved_yes(m):
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
    return None  # 50-50 or unresolved


def market_rows(e, seen):
    """Resolved binary markets of one Gamma event, as compact rows (skips ids in `seen`)."""
    tags = [t.get("slug") for t in (e.get("tags") or []) if t.get("slug")]
    cat, niche = classify(tags)
    out = []
    for m in e.get("markets") or []:
        if m.get("id") in seen:
            continue
        y = resolved_yes(m)
        toks = json.loads(m.get("clobTokenIds") or "[]")
        outs = json.loads(m.get("outcomes") or "[]")
        if y is None or len(toks) != 2:
            continue
        refs = [parse_ts(m.get(k)) for k in ("closedTime", "endDate", "gameStartTime")]
        refs = [r for r in refs if r]
        start = parse_ts(m.get("startDate")) or parse_ts(m.get("createdAt"))
        if not refs or not start:
            continue
        ref = min(refs)
        if ref - start < 3600:
            continue
        seen.add(m["id"])
        out.append(dict(
            id=m["id"], question=m.get("question"), event=e.get("title"),
            event_id=e.get("id"), slug=e.get("slug"), category=cat, niche=niche,
            tags=tags, outcomes=outs, tokens=toks, yes_won=y, ref_ts=ref,
            start_ts=start, volume=float(m.get("volumeNum") or m.get("volume") or 0),
            neg_risk=bool(m.get("negRisk")), market_type=m.get("sportsMarketType"),
        ))
    return out


def _iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


MAX_OFFSET = 2000  # Gamma rejects deeper offsets ("offset too large")


def closed_events(tag, lo, hi, order="endDate"):
    """Every closed event of `tag` with end date in [lo, hi]. Pages up to Gamma's offset
    limit; a window with more events than that is split in half and each half fetched."""
    out = []
    for off in range(0, MAX_OFFSET + 1, 100):
        try:
            evs = http("GET", f"{GAMMA}/events", params=dict(
                limit=100, offset=off, closed="true", order=order, ascending="false",
                end_date_min=_iso(lo), end_date_max=_iso(hi), tag_slug=tag))
        except RuntimeError as e:
            if "offset too large" not in str(e):
                raise
            break  # Gamma's offset cap is lower than MAX_OFFSET today: split the window instead
        out += evs or []
        if len(evs or []) < 100:
            return out
    if hi - lo <= 60:  # cannot split further; keep what we have
        return out
    out.clear()  # the halves refetch these; don't hold thousands of full events while recursing
    mid = (lo + hi) / 2
    return closed_events(tag, mid, hi, order) + closed_events(tag, lo, mid, order)


def iter_closed_events(tag, lo, hi, order="endDate", limit=0, pause=0.0):
    """Closed events of `tag` with end date in [lo, hi], newest first, streamed one page at a time
    (the caller converts and writes them; nothing is held here but the ids already yielded).
    limit: stop after this many events (0 = all). A window with more events than Gamma's offset limit
    is split in half, newer half first; the halves refetch events already yielded, which are skipped."""
    yielded, stack = set(), [(lo, hi)]
    while stack:
        a, b = stack.pop()
        full = True  # stays True only if the window still had events past the offset limit
        for off in range(0, MAX_OFFSET + 1, 100):
            try:
                evs = http("GET", f"{GAMMA}/events", params=dict(
                    limit=100, offset=off, closed="true", order=order, ascending="false",
                    end_date_min=_iso(a), end_date_max=_iso(b), tag_slug=tag)) or []
            except RuntimeError as e:
                if "offset too large" not in str(e):
                    raise
                break  # Gamma's offset cap is lower than MAX_OFFSET today: split
            for e in evs:
                if e.get("id") in yielded:
                    continue
                yielded.add(e.get("id"))
                yield e
                if limit and len(yielded) >= limit:
                    return
            if len(evs) < 100:
                full = False  # window exhausted
                break
            if pause:
                time.sleep(pause)
        if full and b - a > 60:  # a window under a minute cannot be split further; keep what we have
            mid = (a + b) / 2
            stack += [(a, mid), (mid, b)]  # popped newer half first


def sample(days, per_tag, order="endDate", out=OUT, now=None, log=print, pause=0.0):
    """Default mode: the newest `per_tag` closed events per tag (0 = all) with end date in the last
    `days` days. Rows stream to `out`.part and replace `out` when every tag is done."""
    now = time.time() if now is None else now
    seen, total, part = set(), 0, out + ".part"
    with open(part, "w") as f:
        for tag in SAMPLE_TAGS:
            n_ev = 0
            for e in iter_closed_events(tag, now - days * DAY, now, order, limit=per_tag, pause=pause):
                n_ev += 1
                for r in market_rows(e, seen):
                    f.write(json.dumps(r) + "\n")
                    total += 1
            log(f"{tag:12s} events={n_ev:5d} markets_total={total}")
    os.replace(part, out)
    log(f"wrote {total} markets -> {out}")
    return total


def windows(anchor, days, window_days):
    """(lo, hi) end-date windows from `anchor` back `days` days, newest first."""
    out, hi = [], anchor
    while hi > anchor - days * DAY:
        lo = max(hi - window_days * DAY, anchor - days * DAY)
        out.append((lo, hi))
        hi = lo
    return out


def _trim_partial(path):
    """Cut a trailing partial line (no newline yet) off `path`, reading only its tail."""
    if not os.path.exists(path):
        return
    with open(path, "rb+") as f:
        end = f.seek(0, os.SEEK_END)
        pos = end
        while pos > 0:
            step = min(65536, pos)
            f.seek(pos - step)
            i = f.read(step).rfind(b"\n")
            if i >= 0:
                pos = pos - step + i + 1
                break
            pos -= step
        if pos < end:
            f.truncate(pos)


# Windows checkpointed before T-278 have no cap recorded; refresh.yml always fetched them at --per-window 200.
LEGACY_CAP = 200


def backfill(days, window_days, per_window, order, out=OUT, state_p=STATE, log=print, pause=0.0):
    """Resumable windowed fetch. The window grid is anchored at the first run's midnight
    (stored in the state file) so a rerun on a later day resumes the same windows.
    per_window: events per tag per window, newest first (0 = all). A (window, tag) counts as done
    only if it was fetched at this cap or a bigger one, so raising the cap tops windows up."""
    st = json.load(open(state_p)) if os.path.exists(state_p) else {}
    st.setdefault("anchor", int(time.time() // DAY * DAY))
    done = set(st.get("done", []))
    caps = st.setdefault("caps", {})
    seen = set()
    _trim_partial(out)  # a killed run can leave half a row at the end
    if os.path.exists(out):  # ids already stored: resume without duplicates
        with open(out) as f:
            for line in f:
                i = line.find('"id": "')
                if i >= 0:
                    seen.add(line[i + 7:line.index('"', i + 7)])
    total = len(seen)

    def covered(key):
        if key not in done:
            return False
        cap = caps.get(key, LEGACY_CAP)
        return cap == 0 or (per_window != 0 and cap >= per_window)

    for lo, hi in windows(st["anchor"], days, window_days):
        for tag in SAMPLE_TAGS:
            key = f"{int(lo)}|{tag}"
            if covered(key):
                continue
            # rows stream to disk as each page arrives; the checkpoint comes after: a crash repeats, never skips
            with open(out, "a") as f:
                for e in iter_closed_events(tag, lo, hi, order, limit=per_window, pause=pause):
                    for r in market_rows(e, seen):
                        f.write(json.dumps(r) + "\n")
                        total += 1
            done.add(key)
            caps[key] = per_window
            st["done"] = sorted(done)
            with open(state_p + ".tmp", "w") as f:
                json.dump(st, f)
            os.replace(state_p + ".tmp", state_p)
        log(f"window {_iso(lo)[:10]}..{_iso(hi)[:10]} markets_total={total}")
    log(f"backfill done: {total} markets -> {out}")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--per-tag", type=int, default=2000, help="newest events per tag (0 = all; above ~2000 works)")
    # Order by end date, NOT volume: final volume is partly caused by the outcome
    # (upsets attract trading), so ranking by it biases the sample toward longshot wins.
    ap.add_argument("--order", default="endDate")
    ap.add_argument("--window-days", type=int, default=0, help="backfill mode (resumable), see top")
    ap.add_argument("--per-window", type=int, default=300, help="events per tag per window (0 = all)")
    ap.add_argument("--pause", type=float, default=0.1, help="seconds between Gamma pages (rate limit courtesy)")
    a = ap.parse_args()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    log = lambda s: print(s, flush=True)  # noqa: E731
    if a.window_days:
        return backfill(a.days, a.window_days, a.per_window, a.order, log=log, pause=a.pause)
    return sample(a.days, a.per_tag, a.order, log=log, pause=a.pause)


if __name__ == "__main__":
    main()
