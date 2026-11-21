// Derived attributes parsed once at load (docs/03 §2).
import type { Derived, Frequency, Market, Period } from "@/lib/types";

const PERIOD_RE = /\b(1H|2H|1Q|2Q|3Q|4Q|1st Half|2nd Half)\b/;
// docs regex is /temperature in ([A-Za-z .]+) be/; widened so "Seoul (Incheon)" parses too.
const CITY_RE = /temperature in (.+?) be\b/i;

const WINDOW_TAGS: Record<string, NonNullable<Derived["crypto_window"]>> = {
  "15M": "15M", hourly: "hourly", "1H": "hourly", daily: "daily", weekly: "weekly",
};

export function derive(m: Market): Derived {
  const tags = new Set(m.tags);
  const p = PERIOD_RE.exec(m.question)?.[1];
  const period: Period = p === "1st Half" ? "1H" : p === "2nd Half" ? "2H" : ((p as Period | undefined) ?? "full");

  const weather = m.category === "weather";
  const city = weather ? (CITY_RE.exec(m.question)?.[1].trim() ?? null) : null;
  const temp_kind = tags.has("highest-temperature") ? "high" : tags.has("lowest-temperature") ? "low" : null;

  // Tags must match exactly: "daily-temperature" is not "daily".
  const windows = m.tags.map((t) => WINDOW_TAGS[t]).filter(Boolean);
  const recurring = tags.has("recurring");
  const frequency: Frequency[] = [...new Set<Frequency>([...(recurring ? ["recurring" as const] : []), ...windows])];

  return {
    period,
    city,
    temp_kind,
    crypto_window: m.category === "crypto" ? (windows[0] ?? null) : null,
    frequency,
    is_live: m.hours_to_close <= 0,
    recurring,
  };
}
