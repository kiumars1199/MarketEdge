// The light half of lib/api.ts (T-295): the fetch helper, the Free pending state and /api/meta. No filter schemas, no
// zod, so components on every page (components/header/FreshnessPill.tsx) can import it. lib/api.ts re-exports it all.
import type { MetaResponse } from "./api";
import { behindWords } from "@/lib/format";

/** 503 `code` when Free has no delayed scan yet (lib/data/store.ts DelayedPending). */
export const DELAYED_PENDING = "delayed_pending";
export const delayedPendingLine = (min: number) => `Free prices run ${behindWords(min)}; the first update is on its way.`;
/** Error-message prefix the screeners read to show the honest pending state instead of "Couldn't load". */
export const PENDING_PREFIX = "pending: ";

export async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (body?.code === DELAYED_PENDING) throw new Error(PENDING_PREFIX + (body.error ?? ""));
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchMeta = (init?: RequestInit) => get<MetaResponse>("/api/meta", init);
