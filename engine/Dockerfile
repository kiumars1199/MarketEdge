# Kismet engine container (docs/14 §4). Build from the repo root:
#   docker build -f engine/Dockerfile -t kismet-engine .
# Runs ops/scheduler.py: scan every 10 min, update+fit hourly, backtest daily, upload to Supabase Storage.
# Mount a persistent volume at /app/data (market history + output/), or every restart re-bootstraps (~1 hour).
#
# Non-root: the engine always runs as uid 10001. Railway and Fly mount volumes owned by root, so the
# image starts as root only long enough for ops/scheduler.py to chown /app/data and drop to uid 10001
# before any job runs (drop_root); nothing runs as root after that.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY ops/requirements.lock ops/requirements.lock
RUN pip install --no-deps -r ops/requirements.lock

COPY engine engine
COPY pipeline pipeline
COPY config config
COPY ops ops
# Seed for the live flag ledger on a fresh volume (ops/scheduler.py seed_ledger).
COPY output/ledger.jsonl ops/seed/ledger.jsonl

# output/ lives on the volume too (output -> data/output): the append-only ledger must survive restarts.
RUN groupadd --system --gid 10001 engine \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --no-create-home engine \
 && mkdir -p data/output \
 && ln -s data/output output \
 && chown -R engine:engine data

CMD ["python", "ops/scheduler.py"]
