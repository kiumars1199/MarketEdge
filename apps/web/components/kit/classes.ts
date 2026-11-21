// Class strings of the UI kit, in a plain module (no "use client") so server components and the root error and 404
// pages can use them without pulling the kit's client components into every page's first load (QA-A JS budget).
export const card = "rounded-card border border-border bg-surface";
export const inner = "rounded-inner border border-border bg-raised";
export const input =
  "min-h-11 w-full rounded-input border border-border bg-input px-3 py-2 text-base text-text placeholder:text-muted disabled:opacity-50";
export const btn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-input border border-border bg-muted-bg px-4 py-2 text-sm font-medium text-text hover:border-accent-border disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-input bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
export const btnGhost =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-input px-3 py-2 text-sm text-muted hover:bg-muted-bg hover:text-text";
