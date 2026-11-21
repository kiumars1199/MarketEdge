"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Dialog, Field, btn, btnDanger, btnPrimary, input } from "@/components/kit";
import { loadMe, useMe } from "@/lib/me";
import { track } from "@/lib/telemetry";
import type { Tier } from "@/lib/entitlements";

async function goTo(path: string, setError: (s: string) => void) {
  const res = await fetch(path, { method: "POST" }).catch(() => null);
  const body = await res?.json().catch(() => null);
  if (res?.ok && body?.url) window.location.assign(body.url);
  else setError(body?.error ?? "Something went wrong. Try again.");
}

export function AccountActions({ kind, tier, billing, hasCustomer }: { kind: "billing" | "signout"; tier: Tier; billing: boolean; hasCustomer: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (kind === "signout") {
    return (
      <div className="flex flex-wrap gap-2">
        <form method="post" action="/api/auth/signout"><button className={btn}>Sign out</button></form>
        <form method="post" action="/api/auth/signout">
          <input type="hidden" name="scope" value="global" />
          <button className={btn}>Sign out everywhere</button>
        </form>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {hasCustomer && (
          <button type="button" className={btn} disabled={busy} data-testid="manage-billing"
            onClick={async () => { setBusy(true); await goTo("/api/stripe/portal", setError); setBusy(false); }}>
            {busy ? "Opening…" : "Manage billing or cancel"}
          </button>
        )}
        {tier !== "premium" && (billing
          ? <Link href="/pricing" className={btnPrimary}>{tier === "free" ? "Upgrade" : "Get Premium"}</Link>
          : <span className="text-sm text-muted">Paid plans: coming soon</span>)}
      </div>
      {/* #18: Terms and FAQ say "cancel from your account page"; say where, and when there is nothing to cancel */}
      <p data-testid="billing-note" className="max-w-xs text-xs text-muted sm:text-right">
        {hasCustomer
          ? "Change plan, update your card, see receipts or cancel. Cancelling keeps your plan until the end of the period you paid for."
          : tier === "free" ? "No subscription, so nothing to cancel or bill."
          : "Your plan was given to you by Kismet: there's no subscription, so nothing to cancel or bill."}
      </p>
      {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    </div>
  );
}

/** After Stripe Checkout: wait for the webhook to change the plan (never grants access itself, docs/15). */
export function CheckoutStatus() {
  const me = useMe();
  const [gaveUp, setGaveUp] = useState(false);
  const paid = !!me && me.tier !== "free";
  useEffect(() => { if (paid) track("checkout_completed"); }, [paid]);
  useEffect(() => {
    if (paid) return;
    let n = 0;
    const t = setInterval(async () => {
      const m = await loadMe(true);
      if ((m && m.tier !== "free") || ++n >= 30) {
        clearInterval(t);
        if (m && m.tier !== "free") window.location.replace("/account");
        else setGaveUp(true);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [paid]);
  return (
    <p role="status" data-testid="checkout-status" className="rounded-card border border-accent-border bg-accent-bg px-5 py-4 text-sm text-accent-soft">
      {paid ? "Payment confirmed. Your plan is active."
        : gaveUp ? "Payment received. Your plan can take a few minutes to show here; refresh this page shortly."
        : "Confirming your payment with Stripe…"}
    </p>
  );
}

export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const match = typed.trim().toLowerCase() === email.toLowerCase();

  async function remove() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: typed }) }).catch(() => null);
    if (res?.ok) return window.location.assign("/?deleted=1");
    setBusy(false);
    setError((await res?.json().catch(() => null))?.error ?? "Couldn't delete the account. Try again.");
  }

  return (
    <>
      <button type="button" className={`${btnDanger} w-fit`} onClick={() => setOpen(true)}>Delete account…</button>
      <Dialog open={open} onClose={() => { setOpen(false); setTyped(""); setError(""); }} title="Delete your account?">
        <p className="text-sm leading-relaxed text-soft">
          This cancels your subscription now (no further charges) and permanently deletes your saved views, My list, My bets,
          alerts and settings. Download your data first if you want a copy.
        </p>
        <Field label={`Type ${email} to confirm`}>
          {(id) => <input id={id} type="email" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className={input} />}
        </Field>
        {error && <p role="alert" className="text-sm text-warning">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btn} onClick={() => setOpen(false)}>Keep my account</button>
          <button type="button" className={`${btnDanger} !bg-negative !text-white disabled:!bg-muted-bg disabled:!text-muted`} disabled={!match || busy} onClick={remove}>
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
