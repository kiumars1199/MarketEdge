#!/usr/bin/env python3
"""Held: Stripe webhook replay / old timestamp / wrong secret. E2E_MOCK dev server only (secret whsec_e2e).
Usage: python3 -I webhook_checks.py http://localhost:3410"""
import hashlib, hmac, json, sys, time, urllib.request

B = sys.argv[1] + "/api/stripe/webhook"


def send(ev, t, secret="whsec_e2e"):
    p = json.dumps(ev)
    s = hmac.new(secret.encode(), f"{t}.{p}".encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(B, data=p.encode(), headers={"stripe-signature": f"t={t},v1={s}", "content-type": "application/json"})
    try:
        r = urllib.request.urlopen(req)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


now = int(time.time())
ev = {"id": f"evt_rt_replay_{now}", "object": "event", "type": "ping", "created": now, "data": {"object": {}}}
print("fresh:", send(ev, now))
print("replay same id:", send(ev, now))
print("timestamp -10 min:", send({**ev, "id": "evt_old"}, now - 600))
print("wrong secret:", send({**ev, "id": "evt_bad"}, now, "whsec_guess"))
