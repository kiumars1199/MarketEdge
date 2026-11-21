// docs/OVERHAUL.md §C (signed-in pages): shown the instant a tab is tapped, while the server renders the page.
// Each signed-in route's loading.tsx renders this, so Next prefetches it with the link and a tap gets feedback
// in one frame instead of a blank wait. Shapes only, no text or numbers (nothing to read until the data arrives).
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div data-skeleton role="status" aria-live="polite" className="mx-auto w-full max-w-5xl space-y-4">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="h-8 w-56 animate-pulse rounded-input bg-muted-bg" />
      <div aria-hidden="true" className="h-10 w-full animate-pulse rounded-input bg-muted-bg" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-28 w-full animate-pulse rounded-xl bg-muted-bg" />
      ))}
    </div>
  );
}
