"use client";
// QA-A #46/#60 (Marc, Nov 20): the header pill fetched /api/meta on its own, from whichever server instance answered,
// so the header could name one scan while the cards below came from another. A page whose body is built from a scan
// publishes that scan here; the header shows it, and falls back to /api/meta only on pages with no scan-backed body.
// One tab's memory only: Free and paid legitimately see different scans, and tabs are not synchronised.
import { useEffect, useSyncExternalStore } from "react";

let current: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function publishScan(at: number | undefined) {
  if (current === at) return;
  current = at;
  emit();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** The scan the page body was built from (unix s), or undefined on pages without one. */
export const usePageScan = () => useSyncExternalStore(subscribe, () => current, () => undefined);

/** Publish `at` as this page's scan while the caller is mounted. */
export function usePublishScan(at: number | undefined) {
  useEffect(() => {
    publishScan(at);
    return () => publishScan(undefined);
  }, [at]);
}

/** For server-rendered pages: drop `<ScanStamp at={store.meta.scanned_at} />` anywhere in the body. */
export function ScanStamp({ at }: { at: number | undefined }) {
  usePublishScan(at);
  return null;
}
