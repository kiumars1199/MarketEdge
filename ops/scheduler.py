"""Engine loop for the container (docs/14 §4): scan every SCAN_EVERY_SEC (default 120 s), update+fit+grade hourly, backtest daily.

One process runs the jobs in order, so data/ and output/ never see two writers. After every scan
the output is checked and uploaded (ops/upload.py); a failed check keeps the previous data live.

    python ops/scheduler.py            # forever
    python ops/scheduler.py --once     # one tick (for a smoke test)
"""
import argparse
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCAN_EVERY = int(os.environ.get("SCAN_EVERY_SEC") or 120)
# Free stays at least 15 min behind: upload.py rotates its *-prev copies only this far apart (see ROTATE_MIN_SEC there).
ROTATE_MIN_SEC = max(0, 900 - SCAN_EVERY)
BACKTEST_HOUR_UTC = int(os.environ.get("BACKTEST_HOUR_UTC", "6"))


def plan(now, last):
    """Jobs due at unix time `now`, given `last` = {job: unix time it last ran}."""
    hour, day = int(now // 3600), int(now // 86400)
    jobs = []
    if not os.path.exists(os.path.join(ROOT, "data", "sample.jsonl")):
        jobs.append("bootstrap")
    if not os.path.exists(os.path.join(ROOT, "output", "backtest.json")) or (
            int(last.get("backtest", 0) // 86400) < day and time.gmtime(now).tm_hour >= BACKTEST_HOUR_UTC):
        jobs.append("backtest")
    if int(last.get("fit", -1) // 3600) < hour:
        jobs += ["update", "fit", "grade"]
    jobs.append("scan")
    return jobs


CMDS = {
    "bootstrap": [["pipeline/fetch_closed.py"], ["pipeline/fetch_prices.py", "--per-niche", "25000", "--threads", "8"]],
    "update": [["-m", "engine", "update"]],
    "fit": [["-m", "engine", "fit"]],
    "backtest": [["-m", "engine", "backtest"]],
    "grade": [["-m", "engine", "grade"]],  # settles the live flag ledger (ledger_summary.json)
    "scan": [["-m", "engine", "scan"], ["ops/upload.py", "output"]],
}


def run(job):
    for args in CMDS[job]:
        print(f"[scheduler] {job}: python {' '.join(args)}", flush=True)
        env = {**os.environ, "ROTATE_MIN_SEC": os.environ.get("ROTATE_MIN_SEC") or str(ROTATE_MIN_SEC),
               "PYTHONUNBUFFERED": "1"}  # job output reaches the logs even if the job is killed
        if subprocess.run([sys.executable, *args], cwd=ROOT, env=env).returncode != 0:
            print(f"[scheduler] {job} failed; previous data stays live", flush=True)
            return False
    if job == "bootstrap":
        try:
            os.remove(os.path.join(ROOT, "data", "markets.jsonl"))
        except FileNotFoundError:
            pass
    return True


def tick(last):
    now = time.time()
    for job in plan(now, last):
        ok = run(job)
        last[job] = now  # a failed job waits for its next slot instead of retrying every tick
        if job == "bootstrap" and not ok:
            return  # no history yet: nothing else can run


ENGINE_UID = 10001


def drop_root():
    """Container start: give the mounted volume to the engine user, then never run as root again."""
    if os.getuid() != 0:
        return
    for d in ("data", os.path.join("data", "output")):  # image: output -> data/output (on the volume)
        p = os.path.join(ROOT, d)
        os.makedirs(p, exist_ok=True)
        for base, dirs, files in os.walk(p):
            for name in [base, *(os.path.join(base, x) for x in dirs + files)]:
                os.lchown(name, ENGINE_UID, ENGINE_UID)
    os.setgroups([])
    os.setgid(ENGINE_UID)
    os.setuid(ENGINE_UID)
    assert os.getuid() == ENGINE_UID and os.geteuid() == ENGINE_UID


def seed_ledger():
    """First start on an empty volume: continue the live flag ledger from the copy baked into the image."""
    dst, seed = os.path.join(ROOT, "output", "ledger.jsonl"), os.path.join(ROOT, "ops", "seed", "ledger.jsonl")
    if not os.path.exists(dst) and os.path.exists(seed):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(seed, dst)


def main(argv=None):
    a = argparse.ArgumentParser(prog="ops/scheduler.py")
    a.add_argument("--once", action="store_true")
    once = a.parse_args(argv).once
    drop_root()
    seed_ledger()
    last = {}
    while True:
        start = time.time()
        tick(last)
        if once:
            return 0
        time.sleep(max(5, SCAN_EVERY - (time.time() - start) % SCAN_EVERY))


if __name__ == "__main__":
    sys.exit(main())
