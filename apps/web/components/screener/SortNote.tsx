"use client";
// QA-A #47: a link with a sort we don't have (`s=bogus.up`) falls back to the page's usual order and says so.
import { useSearchParams } from "next/navigation";
import { sortRejected } from "@/lib/filters/url";

export function SortNote() {
  if (!sortRejected(useSearchParams())) return null;
  return (
    <p data-testid="sort-note" role="status" className="text-xs text-muted">
      That link asked for a sort we don&apos;t have, so these are in the usual order.
    </p>
  );
}
