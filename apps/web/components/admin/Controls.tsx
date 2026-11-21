"use client";
// Admin panel controls (T-141). Display only: every action is checked again by /api/admin (admin, origin,
// rate limit, zod, typed confirmation, never on your own account) and written to the audit log.
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Dialog, Field, Switch, btn, btnDanger, btnGhost, btnPrimary, input } from "@/components/kit";
import type { Settings } from "@/lib/settings-core";
import type { SignupDay } from "./SignupsChart";

const LazySignupsChart = dynamic(() => import("./SignupsChart"), { ssr: false, loading: () => <div className="h-[200px]" /> });

async function post(body: object): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await res?.json().catch(() => null);
  return res?.ok ? { ok: true, data } : { ok: false, error: data?.error ?? "Couldn't reach the server. Try again." };
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (body: object, done: string) => {
    setBusy(true);
    setMsg(null);
    const r = await post(body);
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? done : r.error! });
    if (r.ok) router.refresh();
    return r.ok;
  };
  return { busy, msg, run };
}

const Note = ({ msg }: { msg: { ok: boolean; text: string } | null }) =>
  msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-accent-soft" : "text-warning"}`}>{msg.text}</p>;

const SECTIONS = [
  { href: "/admin", label: "Overview" }, { href: "/admin/users", label: "Users" }, { href: "/admin/grants", label: "Plan grants" }, { href: "/admin/settings", label: "Site settings" },
  { href: "/admin/funnel", label: "Funnel" }, { href: "/admin/health", label: "System health" }, { href: "/admin/audit", label: "Audit log" },
] as const;

export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
      {SECTIONS.map((s) => {
        const on = s.href === "/admin" ? path === "/admin" : path === s.href || path.startsWith(s.href + "/");
        return (
          <Link key={s.href} href={s.href} aria-current={on ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors duration-150 ${on ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SignupsChart({ rows }: { rows: SignupDay[] }) {
  return <LazySignupsChart rows={rows} />;
}

/** Comp a tier (optional expiry), remove the comp, send a sign-in link. A comp is a plan grant on the user's email
 *  (docs/19 P8), so it is listed on /admin/grants and removing it here also ends the grant. */
export function CompAndLink({ userId, email, comp }: { userId: string; email: string; comp: string | null }) {
  const { busy, msg, run } = useAction();
  const [tier, setTier] = useState<"pro" | "premium">("pro");
  const [until, setUntil] = useState("");
  const expires = until ? new Date(`${until}T23:59:59`).toISOString() : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Comp plan">
          {(id) => (
            <select id={id} value={tier} onChange={(e) => setTier(e.target.value as "pro" | "premium")} className={`${input} w-36`}>
              <option value="pro">Pro</option><option value="premium">Premium</option>
            </select>
          )}
        </Field>
        <Field label="Until (optional)">
          {(id) => <input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={`${input} w-44`} />}
        </Field>
        <button type="button" className={btnPrimary} disabled={busy}
          onClick={() => run({ action: "grant", email, tier, expires_at: expires },`Comped ${tier === "pro" ? "Pro" : "Premium"}${until ? ` until ${until}` : ""}.`)}>
          Grant comp
        </button>
        {comp && <button type="button" className={btn} disabled={busy} onClick={() => run({ action: "uncomp", user_id: userId }, "Comp removed.")}>Remove comp</button>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} disabled={busy} onClick={() => run({ action: "send_link", user_id: userId }, "Sign-in link emailed to the user.")}>Email a sign-in link</button>
        <span className="text-xs text-muted">The link goes to their inbox only.</span>
      </div>
      <Note msg={msg} />
    </div>
  );
}

/** Revoke sessions / delete: type the user's email to confirm (like account delete). */
export function Destructive({ userId, email, kind }: { userId: string; email: string; kind: "revoke_sessions" | "delete_user" }) {
  const router = useRouter();
  const { busy, msg, run } = useAction();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const match = typed.trim().toLowerCase() === email.toLowerCase();
  const del = kind === "delete_user";
  const copy: Record<typeof kind, { button: string; title: string; body: ReactNode; go: string }> = {
    revoke_sessions: {
      button: "Sign out everywhere…", title: "Sign this user out everywhere?", go: "Sign out everywhere",
      body: "Ends every session on every device. They can sign in again with a new link.",
    },
    delete_user: {
      button: "Delete user…", title: "Delete this user?", go: "Delete permanently",
      body: "Cancels their Stripe subscription first, then permanently deletes the account and every saved item. This can't be undone.",
    },
  };
  const c = copy[kind];
  const close = () => { setOpen(false); setTyped(""); };
  return (
    <>
      <button type="button" className={`${btnDanger} w-fit`} onClick={() => setOpen(true)}>{c.button}</button>
      <Dialog open={open} onClose={close} title={c.title}>
        <p className="text-sm leading-relaxed text-soft">{c.body}</p>
        <Field label={`Type ${email} to confirm`}>
          {(id) => <input id={id} type="email" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className={input} />}
        </Field>
        <Note msg={msg} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btn} onClick={close}>Cancel</button>
          <button type="button" className={`${btnDanger} !bg-negative !text-white disabled:!bg-muted-bg disabled:!text-muted`} disabled={!match || busy}
            onClick={async () => {
              const ok = await run({ action: kind, user_id: userId, confirm: typed }, del ? "User deleted." : "Signed out everywhere.");
              if (ok) { close(); if (del) router.push("/admin/users"); }
            }}>
            {busy ? "Working…" : c.go}
          </button>
        </div>
      </Dialog>
    </>
  );
}

const Row = ({ title, hint, children }: { title: string; hint: ReactNode; children: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border px-4 py-4 first:border-t-0 md:px-5">
    <div className="min-w-0 max-w-xl"><p className="font-medium">{title}</p><p className="text-sm text-muted">{hint}</p></div>
    {children}
  </div>
);

/** Site settings. Each save sends only what changed; the server validates, applies and audits. */
export function SettingsForm({ initial, tradingOn }: { initial: Settings; tradingOn: boolean }) {
  const { busy, msg, run } = useAction();
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [allow, setAllow] = useState(initial.trading_allowlist.join(", "));
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const next = { ...s, trading_allowlist: allow.split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean) };
  const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved[k as keyof Settings])));
  const dirty = Object.keys(patch).length > 0;

  return (
    <form className="flex flex-col gap-5" onSubmit={async (e) => {
      e.preventDefault();
      if (await run({ action: "settings", patch }, "Saved. Live on this server now, everywhere within a minute.")) setSaved(next);
    }}>
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <Row title="Announcement banner" hint="Shown at the top of every page, to everyone.">
          <Switch checked={s.banner_on} onChange={(v) => set("banner_on", v)} label="Show announcement banner" />
        </Row>
        <div className="border-t border-border px-4 pb-4 md:px-5">
          <Field label="Banner text" hint={`${s.banner_text.length}/280. Plain text.`}>
            {(id) => <input id={id} maxLength={280} value={s.banner_text} onChange={(e) => set("banner_text", e.target.value)} className={input} placeholder="Scheduled maintenance tonight at 11 pm ET" />}
          </Field>
        </div>
        <Row title="Maintenance mode" hint="Everyone except admins sees a maintenance page; the API answers 503. Sign-in stays open.">
          <Switch checked={s.maintenance} onChange={(v) => set("maintenance", v)} label="Maintenance mode" />
        </Row>
        <Row title="Sign-ups open" hint="Off: existing accounts can still sign in; new emails and new Google accounts are refused.">
          <Switch checked={s.signups_open} onChange={(v) => set("signups_open", v)} label="Sign-ups open" />
        </Row>
        <Row title="Alert sending" hint="Off: the alert job skips every run. Rules stay saved.">
          <Switch checked={s.alerts_enabled} onChange={(v) => set("alerts_enabled", v)} label="Alert sending on" />
        </Row>
        <Row title="Free plan: rows per request" hint="1–200. Default 25. Trimmed on the server.">
          <input type="number" min={1} max={200} step={1} required value={s.free_rows} aria-label="Free plan rows per request"
            onChange={(e) => set("free_rows", Math.trunc(Number(e.target.value)))} className={`${input} w-28 tabular-nums`} />
        </Row>
        <Row title="Free plan: data delay (minutes)" hint="0–60. Default 15. Free sees the scan from at least this long ago.">
          <input type="number" min={0} max={60} step={1} required value={s.free_delay_min} aria-label="Free plan data delay in minutes"
            onChange={(e) => set("free_delay_min", Math.trunc(Number(e.target.value)))} className={`${input} w-28 tabular-nums`} />
        </Row>
        <Row title="Paper-trading allowlist" hint={tradingOn ? "Emails that see the paper Trade ticket, on top of TRADING_ALLOWLIST." : "Only used when KALSHI_TRADING_ENV is set (it isn't now)."}>
          <textarea value={allow} onChange={(e) => setAllow(e.target.value)} rows={2} aria-label="Paper-trading allowlist emails"
            placeholder="name@example.com, other@example.com" className={`${input} w-full md:w-96`} />
        </Row>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary} disabled={!dirty || busy}>{busy ? "Saving…" : "Save changes"}</button>
        {dirty && <button type="button" className={btn} onClick={() => { setS(saved); setAllow(saved.trading_allowlist.join(", ")); }}>Discard</button>}
        <Note msg={msg} />
      </div>
    </form>
  );
}

export interface Grant { email: string; tier: "pro" | "premium"; expires_at: string | null; applied_at: string | null; updated_at: string }

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const planName = (t: string) => (t === "premium" ? "Premium" : "Pro");

/** Grant a plan by email (docs/19 P8): create, edit (same form, prefilled), revoke. Works before the person signs up. */
export function Grants({ rows }: { rows: Grant[] }) {
  const { busy, msg, run } = useAction();
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<"pro" | "premium">("pro");
  const [until, setUntil] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const reset = () => { setEmail(""); setTier("pro"); setUntil(""); setEditing(null); };
  const expires = until ? new Date(`${until}T23:59:59`).toISOString() : null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <form className={`flex flex-col gap-4 rounded-card border bg-surface p-4 md:p-5 ${editing ? "border-accent-border" : "border-border"}`}
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run({ action: "grant", email, tier, expires_at: expires },
            `${editing ? "Updated" : "Granted"} ${planName(tier)} for ${email.trim().toLowerCase()}${until ? ` until ${until}` : ""}.`);
          if (ok) reset();
        }}>
        <div>
          <h2 className="font-semibold">{editing ? `Edit grant for ${editing}` : "Grant a plan"}</h2>
          <p className="text-sm text-muted">Applies now if the email has an account, otherwise the first time they sign in. Never lowers a paid plan.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Email" className="min-w-0 flex-[1_1_240px]">
            {(id) => <input id={id} type="email" required autoComplete="off" value={email} readOnly={!!editing}
              onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={`${input} read-only:text-muted`} />}
          </Field>
          <Field label="Plan">
            {(id) => (
              <select id={id} value={tier} onChange={(e) => setTier(e.target.value as "pro" | "premium")} className={`${input} w-36`}>
                <option value="pro">Pro</option><option value="premium">Premium</option>
              </select>
            )}
          </Field>
          <Field label="Until (optional)">
            {(id) => <input id={id} type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} className={`${input} w-44`} />}
          </Field>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Saving…" : editing ? "Save grant" : "Grant plan"}</button>
          {editing && <button type="button" className={btn} onClick={reset}>Cancel</button>}
        </div>
        <Note msg={msg} />
      </form>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[640px] text-sm" data-testid="grants">
          <thead className="text-left text-xs text-muted">
            <tr><th className="px-4 py-3 font-medium md:px-5">Email</th><th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Until</th><th className="px-3 py-3 font-medium">Status</th><th className="px-4 py-3 md:px-5"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const expired = !!g.expires_at && Date.parse(g.expires_at) <= Date.now();
              return (
                <tr key={g.email} className="border-t border-border">
                  <td className="max-w-[280px] truncate px-4 py-3 md:px-5" title={g.email}>{g.email}</td>
                  <td className="px-3 py-3">{planName(g.tier)}</td>
                  <td className="px-3 py-3 tabular-nums text-soft">{g.expires_at ? dateOnly(g.expires_at) : "No end date"}</td>
                  <td className="px-3 py-3 text-soft">{expired ? <span className="text-warning">Expired</span> : g.applied_at ? "On account" : "Waiting for sign-up"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right md:px-5">
                    <button type="button" className={btnGhost} onClick={() => {
                      setEditing(g.email); setEmail(g.email); setTier(g.tier); setUntil(expired ? "" : dateOnly(g.expires_at));
                      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                    }}>Edit</button>
                    <button type="button" className={`${btnGhost} hover:!text-negative`} onClick={() => setRevoking(g)}>Revoke</button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No grants yet. Grant a plan above to give someone Pro or Premium without paying.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={!!revoking} onClose={() => setRevoking(null)} title="Revoke this grant?">
        <p className="text-sm leading-relaxed text-soft">
          {revoking?.email} loses the granted {planName(revoking?.tier ?? "pro")} plan now. A plan they pay for is not affected.
        </p>
        {msg && !msg.ok && <Note msg={msg} />}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btn} onClick={() => setRevoking(null)}>Cancel</button>
          <button type="button" className={`${btnDanger} !bg-negative !text-white`} disabled={busy}
            onClick={async () => {
              const g = revoking!;
              if (await run({ action: "ungrant", email: g.email }, `Revoked the grant for ${g.email}.`)) {
                setRevoking(null);
                if (editing === g.email) reset();
              }
            }}>
            {busy ? "Revoking…" : "Revoke grant"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
