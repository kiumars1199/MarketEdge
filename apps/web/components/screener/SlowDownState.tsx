/** RT3-02: a page load over the rate limit or the Free row budget. An honest wait, not an error. */
export function SlowDownState() {
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6">
      <p className="font-semibold">Slow down a little</p>
      <p className="max-w-prose text-sm text-muted">You&apos;re opening market pages faster than we allow. Wait a minute, then reload this page.</p>
    </div>
  );
}
