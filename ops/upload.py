"""Upload output/*.json and *.jsonl to the private Supabase Storage bucket `scan` (docs/14 §4), gzip-compressed
under the same object names (T-277; readers sniff the gzip magic bytes, so plain objects still read).

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python ops/upload.py [output_dir]

Runs the docs/12 data checks first (scanned_at must be newer than the copy in the bucket).
Any failure uploads nothing, so the web app keeps serving the previous scan. Exit 1 on failure.

After a good upload (T-295) it asks the site to regenerate its prerendered pages (POST /api/revalidate) and requests
each one once so the edge cache holds the new scan. Optional, log-only, never changes the exit code:
    REVALIDATE_URL (or SITE_URL + /api/revalidate)   REVALIDATE_SECRET (or CRON_SECRET)
"""
import glob
import gzip
import json
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks import check_dir  # noqa: E402

BUCKET = "scan"
GZIP_MAGIC = b"\x1f\x8b"


def gz(body):
    """T-277: objects are stored gzip-compressed under their usual names (markets.json is ~20 MB plain, ~2 MB
    gzipped). No Content-Encoding header: readers (this file's get_json, apps/web lib/data/store.ts) sniff the gzip
    magic bytes 1f 8b and inflate themselves, so plain objects from before the rollout still read, and an HTTP layer
    that does decode transparently can't break them either."""
    return gzip.compress(body, compresslevel=6, mtime=0)


def ungz(body):
    """Bytes as stored: gzip (sniffed by magic bytes) or plain."""
    return gzip.decompress(body) if body[:2] == GZIP_MAGIC else body


class Storage:
    def __init__(self, url, key, http=None):
        self.base = url.rstrip("/") + "/storage/v1/object"
        self.headers = {"Authorization": f"Bearer {key}", "apikey": key}
        self.http = http or requests.Session()

    def get_json(self, name):
        r = self.http.get(f"{self.base}/authenticated/{BUCKET}/{name}", headers=self.headers, timeout=60)
        if r.status_code in (400, 404):  # Storage answers 400 for a missing object
            return None
        r.raise_for_status()
        return json.loads(ungz(r.content))

    def put(self, name, body):
        """Upload `body` (plain bytes) gzip-compressed under `name` (see gz)."""
        r = self.http.post(f"{self.base}/{BUCKET}/{name}", data=gz(body), timeout=300,
                           headers={**self.headers, "Content-Type": "application/gzip", "x-upsert": "true",
                                    "Cache-Control": "no-cache"})
        r.raise_for_status()

    def copy(self, src, dst, missing_ok=False):
        """Server-side copy inside the bucket (no 20 MB round trip). Delete first: copy won't overwrite.
        missing_ok: a missing source (400/404) is not an error; returns False."""
        r = self.http.delete(f"{self.base}/{BUCKET}/{dst}", headers=self.headers, timeout=60)
        if r.status_code not in (200, 204, 400, 404):
            r.raise_for_status()
        r = self.http.post(f"{self.base}/copy", timeout=120,
                           data=json.dumps({"bucketId": BUCKET, "sourceKey": src, "destinationKey": dst}),
                           headers={**self.headers, "Content-Type": "application/json"})
        if missing_ok and r.status_code in (400, 404):
            return False
        r.raise_for_status()
        return True


# Free tier is at least 15 min behind (docs/15): before the new scan lands, the current one is kept as *-prev.json
# and the one before it as *-prev2.json, so every web instance (including a cold one) can serve free users the newest
# scan that is old enough. Two copies (RT3-03): at a 10-minute cadence the replaced scan is only ~10 min old.
# Same shift as engine scan_keeping_prev and refresh.yml.
DELAYED = ("markets.json", "flags.json")
# T-295: the precomputed files (engine/precompute.py) rotate with them, so Free's top.json is as old as its markets.
# A bucket from before T-295 has no top.json / counts.json yet: their copies may 404.
PRECOMPUTED = ("top.json", "counts.json")
# At a fast scan cadence (ops/scheduler.py, SCAN_EVERY_SEC=120) two copies taken every scan would be only 2 and 4
# minutes old, and Free would get nothing. So the scheduler sets ROTATE_MIN_SEC (15 min minus the cadence): the live
# scan only becomes *-prev.json once it is that much newer than the current *-prev.json, which keeps *-prev2.json at
# least 15 min old. 0 (the default) rotates on every upload, as before.
ROTATE_MIN_SEC = int(os.environ.get("ROTATE_MIN_SEC") or 0)
prev_name = lambda name: name.replace(".json", "-prev.json")  # noqa: E731
prev2_name = lambda name: name.replace(".json", "-prev2.json")  # noqa: E731


def _secs(at):
    """scanned_at as epoch seconds (ISO string or number)."""
    if isinstance(at, (int, float)):
        return float(at)
    from datetime import datetime
    return datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()


def _rotate(storage, prev_at, gap, log):
    if gap <= 0 or prev_at is None:
        return True
    pp = storage.get_json(prev_name("flags.json"))
    pp_at = (pp or {}).get("meta", {}).get("scanned_at")
    if pp_at is None or _secs(prev_at) - _secs(pp_at) >= gap:
        return True
    log(f"kept *-prev.json as is: the live scan is less than {gap}s newer (Free stays at least 15 min behind)")
    return False


def publish(out_dir, storage, log=print, rotate_min_sec=None):
    prev = storage.get_json("flags.json")
    prev_at = (prev or {}).get("meta", {}).get("scanned_at")
    errs = check_dir(out_dir, prev_at)
    if errs:
        for e in errs:
            log(f"data check failed: {e}")
        log("upload skipped; the bucket keeps the previous scan")
        return False
    gap = ROTATE_MIN_SEC if rotate_min_sec is None else rotate_min_sec
    if prev is not None and _rotate(storage, prev_at, gap, log):
        for name in DELAYED + PRECOMPUTED:
            if storage.copy(prev_name(name), prev2_name(name), missing_ok=True):
                log(f"kept {prev_name(name)} as {prev2_name(name)}")
            if storage.copy(name, prev_name(name), missing_ok=name in PRECOMPUTED):
                log(f"kept {name} as {prev_name(name)}")
    files = sorted(glob.glob(os.path.join(out_dir, "*.json")) + glob.glob(os.path.join(out_dir, "*.jsonl")))
    # Local *-prev / *-prev2 copies (engine scan_keeping_prev rotates every scan) are never uploaded: the bucket's own
    # copies, rotated above, are the ones kept far enough apart for the Free delay (T-295: -prev2 was uploaded before).
    files = [p for p in files if not p.endswith(("-prev.json", "-prev2.json"))]
    # flags.json last: it carries the scanned_at that the next run compares against.
    files.sort(key=lambda p: os.path.basename(p) == "flags.json")
    for p in files:
        with open(p, "rb") as f:
            storage.put(os.path.basename(p), f.read())
        log(f"uploaded {os.path.basename(p)}")
    return True


# Mirrors apps/web lib/static-routes.ts STATIC_PAGES (ops/tests/test_ops.py checks they match).
STATIC_PAGES = ("/", "/pricing", "/about", "/track-record", "/terms", "/privacy", "/refunds", "/disclaimer", "/contact")


def revalidate(env=None, http=None, log=print):
    """T-295: POST /api/revalidate so the prerendered pages show this scan, then GET each once to refill the edge
    cache. Skipped when no URL or secret is set; any failure is logged and ignored (the pages still regenerate within
    their 300 s window). Returns True when the site accepted the call."""
    env = os.environ if env is None else env
    url = env.get("REVALIDATE_URL") or (env.get("SITE_URL") and env["SITE_URL"].rstrip("/") + "/api/revalidate")
    secret = env.get("REVALIDATE_SECRET") or env.get("CRON_SECRET")
    if not url or not secret:
        log("revalidate skipped: REVALIDATE_URL (or SITE_URL) and REVALIDATE_SECRET (or CRON_SECRET) not both set")
        return False
    http = http or requests.Session()
    try:
        r = http.post(url, headers={"Authorization": f"Bearer {secret}"}, timeout=30)
        if r.status_code != 200:
            log(f"revalidate failed: HTTP {r.status_code}")
            return False
    except requests.RequestException as e:
        log(f"revalidate failed: {type(e).__name__}")
        return False
    base = url.rsplit("/api/", 1)[0]
    warm = 0
    for path in STATIC_PAGES:
        try:
            warm += http.get(base + path, timeout=30).status_code == 200
        except requests.RequestException:
            pass
    log(f"revalidated {len(STATIC_PAGES)} pages, warmed {warm}")
    return True


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--revalidate-only"]:  # refresh.yml without a bucket: the live branch was just published
        revalidate()
        return 0
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", file=sys.stderr)
        return 1
    try:
        ok = publish(argv[0] if argv else "output", Storage(url, key))
    except (requests.RequestException, OSError, json.JSONDecodeError) as e:
        print(f"upload failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    if ok:
        revalidate()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
