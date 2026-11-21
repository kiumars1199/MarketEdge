/** "Nov 17, 2026" (UTC), or a dash. */
export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

// Grouped stat grid for the admin pages (server component). One bordered panel, hairline dividers.
export function Stats({ label, items }: { label: string; items: { k: string; v: string; sub?: string; title?: string; testId?: string }[] }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2.5">
      <h2 className="text-sm font-medium text-muted">{label}</h2>
      <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border ${items.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
        {items.map((i, n) => (
          <div key={i.k} className={`flex flex-col gap-1 bg-surface px-4 py-3.5 ${items.length % 2 && n === items.length - 1 ? "col-span-2 md:col-span-1" : ""}`} title={i.title}>
            <dt className="text-xs text-muted">{i.k}</dt>
            <dd className="font-heading text-[26px] font-bold leading-tight tracking-[-0.02em] tabular-nums" data-testid={i.testId}>{i.v}</dd>
            {i.sub && <dd className="text-xs text-muted">{i.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
