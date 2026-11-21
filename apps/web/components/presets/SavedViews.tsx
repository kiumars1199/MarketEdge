"use client";
// #19 (Marc, Nov 20): "Saved views" opens the list of the user's saved views (apply, rename, delete) on Best bets and
// All markets. The list itself loads on the first tap.
import dynamic from "next/dynamic";
import { useState } from "react";
import type { FilterState } from "@/lib/filters/state";

const SavedViewsDialog = dynamic(() => import("./SavedViewsDialog"), { ssr: false });

export function SavedViews({ onApply, className }: { onApply: (patch: Partial<FilterState>) => void; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" data-testid="saved-views" onClick={() => setOpen(true)} className={className}>Saved views</button>
      {open && <SavedViewsDialog onApply={onApply} onClose={() => setOpen(false)} />}
    </>
  );
}
