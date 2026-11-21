"use client";
// Sign-in / sign-up form (docs/08): Google first (when enabled), then tabs "Password" (default) and "Email link".
// /login signs in, /signup creates an account (Supabase emails a confirmation link). The 18+/Terms box gates every
// way in. Answers never say whether an address has an account (the server words them that way too).
import Link from "next/link";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { btn, btnPrimary, input } from "@/components/kit";

/** Google sign-in shows only once the owner has configured the provider in Supabase (else it 400s). */
const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";
const PASSWORD_MIN = 8, PASSWORD_MAX = 72;   // lib/auth/password.ts (server-only module)

type Mode = "login" | "signup";
type Tab = "password" | "link";
const TABS: readonly { value: Tab; label: string }[] = [
  { value: "password", label: "Password" },
  { value: "link", label: "Email link" },
];
export const RESET_SENT = "If that email has an account, we sent a reset link. Open it in this browser within 15 minutes.";

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
const errorOf = async (res: Response | null, fallback: string) =>
  ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? fallback;

export function LoginForm({ next, error: initialError, mode = "login" }: { next: string; error?: string; mode?: Mode }) {
  const [tab, setTab] = useState<Tab>("password");
  const [accept, setAccept] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "sent" | "confirm">("idle");
  const [error, setError] = useState(initialError ?? "");
  const [note, setNote] = useState("");
  const [termsError, setTermsError] = useState(false);
  const base = useId();
  const ids = { terms: `${base}terms`, email: `${base}email`, pw: `${base}pw`, hint: `${base}hint`, err: `${base}err`, panel: `${base}panel`, tab: (t: Tab) => `${base}tab-${t}` };
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ password: null, link: null });

  const needTerms = (e: FormEvent) => {
    if (accept) return false;
    e.preventDefault();
    setTermsError(true);
    document.getElementById(ids.terms)?.focus();
    return true;
  };

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    if (needTerms(e)) return;
    setState("busy");
    setError("");
    const res = await post("/api/auth/magic-link", { email: email.trim(), accept: true, next });
    if (res?.ok) return setState("sent");
    setState("idle");
    setError(await errorOf(res, "Couldn't send the link. Check your connection and try again."));
  }

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    if (needTerms(e)) return;
    setState("busy");
    setError("");
    setNote("");
    const action = mode === "signup" ? "signup" : "signin";
    const res = await post("/api/auth/password", { action, email: email.trim(), password, accept: true, next });
    if (res?.ok && action === "signup") { setPassword(""); return setState("confirm"); }
    const body = res?.ok ? ((await res.json().catch(() => null)) as { to?: string } | null) : null;
    if (body?.to) return window.location.assign(body.to);   // full load: the server renders with the new session
    setState("idle");
    setError(await errorOf(res, "Couldn't sign you in. Check your connection and try again."));
  }

  async function forgot() {
    const el = document.getElementById(ids.email) as HTMLInputElement | null;
    setError("");
    if (!email.trim() || !el?.checkValidity()) {
      setNote("Enter your email above, then choose “Forgot password?” again.");
      el?.focus();
      return;
    }
    setState("busy");
    const res = await post("/api/auth/reset", { email: email.trim() });
    setState("idle");
    // Same answer whether or not the address has an account; only a rate limit or a bad address says otherwise.
    if (res && (res.status === 429 || res.status === 400)) return setError(await errorOf(res, "Try again in a minute."));
    setNote(RESET_SENT);
  }

  const pick = (t: Tab) => { setTab(t); setError(""); setNote(""); };
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.value === tab);
    const to = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i - 1 + TABS.length) % TABS.length]
      : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : undefined;
    if (!to) return;
    e.preventDefault();
    pick(to.value);
    tabRefs.current[to.value]?.focus();
  }

  if (state === "sent" || state === "confirm") {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-card border border-accent-border bg-accent-bg p-5">
        <h2 className="text-lg font-semibold text-accent-soft">Check your email</h2>
        <p className="text-sm leading-relaxed text-accent-softer">
          {state === "sent" ? (
            <>We sent a sign-in link to <span className="font-medium text-accent-soft">{email}</span>. Open it in this browser.
              It works once and expires in 15 minutes.</>
          ) : (
            <>To finish, confirm your email: open the link we sent to <span className="font-medium text-accent-soft">{email}</span> in
              this browser and you&apos;re signed in. Already have an account?{" "}
              {/* P9: was plain text, a dead end for someone who signed up twice */}
              <Link href={`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-accent-soft underline underline-offset-4">Log in instead</Link>.</>
          )}
        </p>
        <button type="button" className="w-fit text-sm text-accent-hover underline-offset-4 hover:underline" onClick={() => setState("idle")}>
          Use a different email
        </button>
      </div>
    );
  }

  const busy = state === "busy";
  const emailField = (
    <>
      <label htmlFor={ids.email} className="text-xs font-medium text-muted">Email</label>
      <input
        id={ids.email} type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com"
        value={email} onChange={(e) => setEmail(e.target.value)} className={input}
      />
    </>
  );
  const terms = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={ids.terms} className="flex cursor-pointer items-start gap-3 rounded-input border border-border bg-surface p-4 text-sm leading-relaxed text-soft has-[:focus-visible]:border-accent-border">
        <input
          id={ids.terms} type="checkbox" checked={accept} required aria-invalid={termsError && !accept}
          onChange={(e) => { setAccept(e.target.checked); setTermsError(false); }}
          className="mt-0.5 size-5 flex-none accent-[var(--accent)]"
        />
        <span>
          I&apos;m 18 or older and agree to the{" "}
          <Link href="/terms" className="text-accent-hover underline underline-offset-4" target="_blank">Terms</Link> and{" "}
          <Link href="/privacy" className="text-accent-hover underline underline-offset-4" target="_blank">Privacy Policy</Link>.
        </span>
      </label>
      {termsError && !accept && <p className="text-xs text-warning">Tick this box to continue.</p>}
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      {error && <p id={ids.err} role="alert" className="rounded-input border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text">{error}</p>}

      {/* P9: with Google on, the box gates that button too, so it sits above everything; without it, the box sits
          right before the submit button, after the fields, where people expect consent */}
      {GOOGLE && terms}

      {GOOGLE && <>
      <form method="post" action="/api/auth/google" onSubmit={needTerms}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="accept" value={accept ? "on" : ""} />
        <button type="submit" className={`${btn} w-full min-h-12 text-[15px]`}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z" />
          </svg>
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
      </div>
      </>}

      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label="Sign-in method" className="flex gap-1 border-b border-border">
          {TABS.map((t) => {
            const on = t.value === tab;
            return (
              <button
                key={t.value} id={ids.tab(t.value)} ref={(el) => { tabRefs.current[t.value] = el; }}
                type="button" role="tab" aria-selected={on} aria-controls={ids.panel} tabIndex={on ? 0 : -1}
                onClick={() => pick(t.value)} onKeyDown={onTabKey}
                className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-4 text-sm ${on ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab(tab)}>
          {tab === "password" ? (
            <form method="post" onSubmit={withPassword} className="flex flex-col gap-3">{/* post: never put credentials in the URL */}
              {emailField}
              <label htmlFor={ids.pw} className="text-xs font-medium text-muted">Password</label>
              <div className="relative">
                <input
                  id={ids.pw} type={show ? "text" : "password"} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"} aria-describedby={ids.hint}
                  value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} w-full pr-20`}
                />
                <button
                  type="button" aria-pressed={show} aria-label="Show password" onClick={() => setShow((v) => !v)}
                  className="absolute inset-y-0 right-0 min-w-16 px-3 text-xs font-medium text-accent-hover"
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
              <p id={ids.hint} className="text-xs text-muted">At least {PASSWORD_MIN} characters.</p>
              {!GOOGLE && terms}
              <button type="submit" className={`${btnPrimary} min-h-12 text-[15px]`} disabled={busy}>
                {busy ? "One moment…" : mode === "signup" ? "Create account" : "Log in"}
              </button>
              <button type="button" onClick={forgot} disabled={busy} className="min-h-11 w-fit text-sm text-accent-hover underline-offset-4 hover:underline">
                Forgot password?
              </button>
              {note && <p role="status" className="text-sm leading-relaxed text-soft">{note}</p>}
            </form>
          ) : (
            <form method="post" onSubmit={sendLink} className="flex flex-col gap-3">{/* post: never put the email in the URL */}
              {emailField}
              {!GOOGLE && terms}
              <button type="submit" className={`${btnPrimary} min-h-12 text-[15px]`} disabled={busy}>
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
              <p className="text-xs text-muted">We email you a link that signs you in. Nothing to remember.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
