"use client";
// /reset-password form: POST /api/auth/password/update (needs the session and reset marker the email link set).
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { btnPrimary, input } from "@/components/kit";

export function ResetForm() {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const id = useId();

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("busy");
    setError("");
    const res = await fetch("/api/auth/password/update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) return setState("done");
    setState("idle");
    setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save it. Check your connection and try again.");
  }

  if (state === "done") {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-card border border-accent-border bg-accent-bg p-5">
        <h2 className="text-lg font-semibold text-accent-soft">Password changed</h2>
        <p className="text-sm leading-relaxed text-accent-softer">You&apos;re signed in. Next time, log in with the new password.</p>
        <Link href="/" className="w-fit text-sm font-medium text-accent-hover underline-offset-4 hover:underline">Go to Best bets</Link>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={save} className="flex flex-col gap-3">
      {error && <p role="alert" className="rounded-input border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text">{error}</p>}
      <label htmlFor={id} className="text-xs font-medium text-muted">New password</label>
      <div className="relative">
        <input
          id={id} type={show ? "text" : "password"} required minLength={8} maxLength={72} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} w-full pr-20`}
        />
        <button type="button" aria-pressed={show} aria-label="Show password" onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-0 min-w-16 px-3 text-xs font-medium text-accent-hover">
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <button type="submit" className={`${btnPrimary} min-h-12 text-[15px]`} disabled={state === "busy"}>
        {state === "busy" ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
