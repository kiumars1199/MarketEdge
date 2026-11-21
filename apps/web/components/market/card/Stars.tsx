// R2-4 value rating: 1–3 stars with a word, or "No value at today's price" (lib/card.ts stars()).
import type { Stars as StarsT } from "@/lib/card";

function Star({ on }: { on: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className={on ? "text-accent" : "text-border"}>
      <path fill="currentColor" d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" />
    </svg>
  );
}

/** `children` replaces the word label (the card puts its one return figure there; the word stays in the aria label). */
export function StarRating({ st, title, children }: { st: StarsT | null; title?: string; children?: React.ReactNode }) {
  if (!st) return <span className="text-muted" title={title}>{children ?? <>No value at today&apos;s price</>}</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span role="img" aria-label={`Value: ${st.label}, ${st.n} of 3 stars`} className="inline-flex">
        {[1, 2, 3].map((i) => <Star key={i} on={i <= st.n} />)}
      </span>
      <span className={st.n === 3 ? "font-semibold text-accent" : "text-soft"}>{children ?? st.label}</span>
    </span>
  );
}
