// Plain-language labels and token classes shared by rows, cards, BetCard and the drawer (docs/06 § Display language).
import { TAXONOMY, topicsOf } from "@/lib/taxonomy";
import { money, type Chance } from "@/lib/format";
import type { Execution, Market, Verdict } from "@/lib/types";

/** Return color: ≥10% strong green, 3–10% green, 0–3% grey, <0 red. */
export function returnTone(roi: number | null | undefined): string {
  if (typeof roi !== "number" || !Number.isFinite(roi)) return "text-muted";
  return roi >= 10 ? "text-accent font-semibold" : roi >= 3 ? "text-positive" : roi >= 0 ? "text-muted" : "text-negative";
}

export const chanceTone = (c: Chance | null) =>
  c === "Leans your way" ? "text-soft" : c === "Long shot" ? "text-warning" : "text-muted";

/** Short topic label for a market: the sports league, else the category ("Weather & Climate" → "Weather"). */
/** The topic a market sits under, as a breadcrumb: label as on the cards, linking to All markets filtered to it. */
export function topicCrumb(m: Pick<Market, "category" | "niche" | "tags" | "market_type">): { label: string; href: string } {
  const ids = topicsOf(m as Market);
  let id: string = m.category;
  if (m.category === "sports") {
    const named = [...ids].filter((x) => !x.endsWith(".other"));
    id = named.find((x) => x.split(".").length === 3) ?? named.find((x) => x.split(".").length === 2) ?? id;
  }
  return { label: topicLabel(m), href: `/markets?${id.includes(".") ? "t" : "c"}=${encodeURIComponent(id)}` };
}

export function topicLabel(m: Pick<Market, "category" | "niche" | "tags" | "market_type">): string {
  const ids = topicsOf(m as Market);
  if (m.category === "sports") {
    // docs/17 fix 14: the league or competition when known ("La Liga"), else the sport ("Soccer")
    const named = [...ids].filter((id) => !id.endsWith(".other"));
    const t = named.find((id) => id.split(".").length === 3) ?? named.find((id) => id.split(".").length === 2);
    if (t) return TAXONOMY[t]!.label;
  }
  return (TAXONOMY[m.category]?.label ?? m.category).split(" & ")[0]!;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  "worth it": "Fair fill",
  thin: "Spread eats most of this",
  "not worth it": "Price too high right now",
  "no sellers": "No sellers right now",
  "no book": "No order book right now",
};

export type Note = { text: string; tone: "warning" | "negative" | "muted" };

/** Quiet price-check notes for a row/card: only speaks up when something's wrong. The "unusually high" edge warning
 *  lives in the drawer only (docs/17 fix 1): repeated on every card it was noise; cards show what similar bets returned. */
export function rowNotes(x: Execution | undefined): Note[] {
  const out: Note[] = [];
  if (x?.verdict === "not worth it") out.push({ text: VERDICT_LABEL["not worth it"], tone: "negative" });
  else if (x?.verdict === "thin") out.push({ text: VERDICT_LABEL.thin, tone: "warning" });
  if (x && x.book_ok !== false && x.verdict !== "not worth it" && x.capacity_usd != null && x.capacity_usd < 100)
    out.push({ text: `Only ~${money(Math.round(x.capacity_usd))} available at this price`, tone: "warning" });
  return out;
}

export const NOTE_TONE: Record<Note["tone"], string> = { warning: "text-warning", negative: "text-negative", muted: "text-muted" };

/** P9: "pts" was unexplained; T-289: the help, the number and the verdict are all lib/betFigures (the gap, won − price). */
export { PTS_HELP } from "@/lib/betFigures";
/** Tone class for a verdict (lib/betFigures `verdict`). */
export const VERDICT_TONE = { up: "text-soft", thin: "text-muted", down: "text-negative" } as const;
