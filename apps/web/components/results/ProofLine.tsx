// T-290: the backtest return never appears alone. This prints lib/proof's line (test result, then the live record
// beside it) with the basis one hover away. No hooks, no server imports: server pages and client components share it.
import type { Proof } from "@/lib/proof";

export function ProofLine({ p, className = "text-sm text-muted", testId = "proof-line", liveOnly = false }: {
  p: Proof; className?: string; testId?: string;
  /** the test result is already printed beside it (drawer, stat tiles): show only the live half */
  liveOnly?: boolean;
}) {
  return (
    <p className={className} data-testid={testId} title={p.help}>
      {p.test && !liveOnly ? <span data-testid="proof-test">{p.test} </span> : null}
      <span data-testid="proof-live" className="cursor-help underline decoration-dotted underline-offset-4">{p.live}</span>
    </p>
  );
}
