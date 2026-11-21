// T-276: what a signed-out visitor may see of one market or event: title, category, closing time. Nothing from the
// model (no verdict, edge, win chance, price or return), so /m/* and /event/* stay indexable without leaking it.
import "server-only";
import { getStoreFor } from "@/lib/data/store";
import { TAXONOMY } from "@/lib/taxonomy";

export interface Teaser { kind: "market" | "event"; id: string; title: string; event?: string; category: string; closes_at: number | null; markets?: number }

const label = (c: string) => TAXONOMY[c]?.label ?? (c ? c[0]!.toUpperCase() + c.slice(1) : "Other");

/** Only these keys ever leave this module. */
export async function marketTeaser(id: string): Promise<Teaser | null> {
  const store = await getStoreFor("free");
  const m = store.flagsById.get(id) ?? store.byId.get(id);
  if (!m) return null;
  return { kind: "market", id: m.id, title: m.question, event: m.event !== m.question ? m.event : undefined, category: label(m.category), closes_at: m.closes_at ?? null };
}

export async function eventTeaser(id: string): Promise<Teaser | null> {
  const store = await getStoreFor("free");
  const ms = store.byEvent.get(id);
  if (!ms?.length) return null;
  const closes = ms.map((m) => m.closes_at).filter((t): t is number => typeof t === "number").sort((a, b) => a - b);
  return { kind: "event", id, title: ms[0]!.event, category: label(ms[0]!.category), closes_at: closes[0] ?? null, markets: ms.length };
}

export const TEASER_LINE = "Kismet has a verdict on this market. Sign up free to see it.";
export const TEASER_DESCRIPTION = "Kismet has a verdict on this market. Sign up free to see it. Market analytics, not financial advice.";
