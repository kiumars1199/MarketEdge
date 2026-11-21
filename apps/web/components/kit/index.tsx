"use client";
// Small UI kit for Lane D2 pages (settings, dashboards, My bets, tools, alerts). Tokens only (docs/06).
import { useEffect, useId, useRef, type ReactNode } from "react";
import { exactCount, formatCount } from "@/lib/format";

export { card, inner, input, btn, btnPrimary, btnGhost } from "./classes";
import { btn, card, input } from "./classes";
const label = "text-xs font-medium text-muted";

/** A count of bets, markets or events: short and rounded down ("9.6K"), exact on hover (docs/18 §4). */
export function Count({ n, className }: { n: number | null | undefined; className?: string }) {
  const short = formatCount(n);
  const exact = exactCount(n);
  return <span className={className} title={short === exact ? undefined : exact}>{short}</span>;
}

export function PageTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] leading-relaxed text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** Labelled form control. `hint` sits under the control. */
export function Field({ label: l, hint, children, className = "" }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={label}>{l}</label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Pill radio group (chips per docs/06). */
export function Segmented<T extends string>({ value, options, onChange, label: l }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={l} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`min-h-11 rounded-full border px-4 text-[13px] ${on ? "border-accent-border bg-accent-bg text-accent-soft" : "border-border bg-input text-soft hover:text-text"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tab strip; content is rendered by the caller. */
export function Tabs<T extends string>({ value, tabs, onChange, label: l }: {
  value: T; tabs: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="tablist" aria-label={l} className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.value)}
            className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-4 text-sm ${on ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label: l }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={l} onClick={() => onChange(!checked)}
      className="group inline-flex h-11 w-14 flex-none items-center justify-center"   // §D (R2-8): 44 px hit area around the 48×28 track
    >
      <span className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${checked ? "border-accent bg-accent" : "border-border bg-muted-bg"}`}>
        <span className={`inline-block size-5 rounded-full bg-text transition-transform ${checked ? "translate-x-6 bg-on-accent" : "translate-x-1"}`} />
      </span>
    </button>
  );
}

/** Native <dialog> with a title and close button. Open while `open` is true. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref} aria-label={title} onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto max-h-[90dvh] w-[min(560px,calc(100vw-24px))] overflow-y-auto rounded-card border border-border bg-surface p-0 text-text backdrop:bg-black/60"
    >
      {open && (
        <div className="flex flex-col gap-5 p-5 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{title}</h2>
            <CloseButton onClick={onClose} />
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

function CloseButton({ onClick, label: l = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={l} className="flex size-11 flex-none items-center justify-center rounded-input bg-muted-bg text-muted hover:text-text">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

/** Small stat: label over a big number. */
export function Stat({ label: l, value, tone, title }: { label: string; value: ReactNode; tone?: "pos" | "neg" | "accent"; title?: string }) {
  const color = tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : tone === "accent" ? "text-accent" : "text-text";
  return (
    <div className={`${card} flex flex-col gap-1 px-4 py-3.5`} title={title}>
      <span className="text-xs text-muted">{l}</span>
      <span className={`font-heading text-[26px] font-bold leading-tight tracking-[-0.02em] tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

/** Number input that reports a finite number or null. */
export function NumberInput({ id, value, onChange, step = "any", min, max, placeholder, prefix, suffix, ariaLabel }: {
  id?: string; value: number | null; onChange: (v: number | null) => void; step?: string; min?: number; max?: number;
  placeholder?: string; prefix?: string; suffix?: string; ariaLabel?: string;
}) {
  return (
    <div className="relative flex items-center">
      {prefix && <span className="pointer-events-none absolute left-3 text-muted">{prefix}</span>}
      <input
        id={id} type="number" inputMode="decimal" step={step} min={min} max={max} placeholder={placeholder} aria-label={ariaLabel}
        value={value ?? ""} onChange={(e) => { const n = e.target.valueAsNumber; onChange(Number.isFinite(n) ? n : null); }}
        className={`${input} tabular-nums ${prefix ? "pl-7" : ""} ${suffix ? "pr-9" : ""}`}
      />
      {suffix && <span className="pointer-events-none absolute right-3 text-muted">{suffix}</span>}
    </div>
  );
}

export const btnDanger = btn.replace("text-text", "text-negative").replace("hover:border-accent-border", "hover:border-negative");
