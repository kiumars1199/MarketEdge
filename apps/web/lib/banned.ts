// docs/OVERHAUL.md §A/§B: words a casual bettor shouldn't meet on the landing page, Best bets, or a bet card.
// One rule for every check (unit, e2e, report): whole words or phrases, case-insensitive, matched against what a
// visitor reads: visible text plus <title>, meta description and og/twitter descriptions. Scripts, JSON/RSC payloads,
// class names and URLs are not checked ("scripts" is not "pts", "event" is not "EV", "knowledge" is not "edge").
export const BANNED: { label: string; re: RegExp }[] = [
  { label: "edge", re: /\bedges?\b/i },
  { label: "spread", re: /\bspreads?\b/i },
  { label: "pts", re: /\bpts?\b\.?/i },
  { label: "model", re: /\bmodel(s|ed|ing)?\b/i },
  { label: "priced below their record", re: /\bpriced below\b/i },
  { label: "$1 share", re: /\$1 shares?\b/i },
  { label: "walk-forward", re: /\bwalk[- ]forward\b/i },
  { label: "EV", re: /\b[+-]?EV\b/ },               // case-sensitive: "ev" inside words never matches anyway
  { label: "t-stat", re: /\bt[- ]?stat(istic)?s?\b/i },
];
/** Any count above 3 digits: "1,234", "1.4K", "12K", "1234". Times ("11:53") and years in dates are not counts. */
export const BIG_COUNT = /(?<![\d:.,/-])(\d{1,3}(,\d{3})+|\d{4,}|\d+(\.\d+)?\s?[KkMm](?![A-Za-z]))(?![\d:/-])/;

export function bannedHits(text: string, opts: { counts?: boolean } = {}): string[] {
  const hits = BANNED.filter((b) => b.re.test(text)).map((b) => `${b.label}: "${text.match(b.re)![0]}"`);
  if (opts.counts) {
    const m = text.replace(/\b(19|20)\d{2}\b/g, "").match(BIG_COUNT);
    if (m) hits.push(`count above 3 digits: "${m[0]}"`);
  }
  return hits;
}

/** What a visitor reads on a page, from rendered HTML: visible text + title + descriptions. Server-side helper for tests. */
export function readableText(html: string): string {
  const meta = [...html.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:description|twitter:description|og:title|twitter:title)"[^>]*content="([^"]*)"/gi)].map((m) => m[1]);
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  return [title, ...meta, body].join(" \n ").replace(/\s+/g, " ");
}
