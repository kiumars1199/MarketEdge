// Topic taxonomy (docs/03 §2): Category → Topic → Sub-topic, as data with match functions.
// Ids: category ("weather", "sports"), topic "<category>.<slug>" ("sports.nfl"), sub-topic
// "<category>.<topic>.<slug>" ("sports.soccer.premier-league"). Every category with topics gets an
// "<category>.other" topic for markets no other topic matches. Market type and period are separate filters.
import type { Market } from "@/lib/types";

export type TaxNode = { id: string; label: string; match: (m: Market) => boolean; children?: TaxNode[] };
type Spec = [slug: string, label: string, tags?: string[], children?: Spec[]];

const hasAny = (m: Market, tags: string[]) => tags.some((t) => m.tags.includes(t));

// A topic matches when the niche is its slug or the market carries one of its tags (default: the slug).
function topic(cat: string, [slug, label, tags = [slug], children]: Spec, parent = cat): TaxNode {
  const id = `${parent}.${slug}`;
  const node: TaxNode = { id, label, match: (m) => m.category === cat && (m.niche === slug || hasAny(m, tags)) };
  if (children) node.children = children.map((c) => topic(cat, c, id));
  return node;
}

function category(cat: string, label: string, topics: Spec[] = [], match?: (m: Market) => boolean): TaxNode {
  const node: TaxNode = { id: cat, label, match: match ?? ((m) => m.category === cat) };
  if (topics.length) {
    const named = topics.map((t) => topic(cat, t));
    const other: TaxNode = { id: `${cat}.other`, label: "Other", match: (m) => node.match(m) && !named.some((c) => c.match(m)) };
    node.children = [...named, other];
  }
  return node;
}

const SOCCER: Spec[] = [
  ["premier-league", "Premier League", ["premier-league", "EPL", "epl"]], ["la-liga", "La Liga"], ["bundesliga", "Bundesliga"],
  ["ligue-1", "Ligue 1"], ["ucl", "Champions League"], ["uefa-nations-league", "UEFA Nations League"],
  ["fifa-friendly", "International friendlies"], ["efl-championship", "EFL Championship"], ["ere", "Eredivisie"],
  ["concacaf-nations-league", "CONCACAF Nations League"], ["la-liga-2", "La Liga 2"], ["bundesliga-2", "2. Bundesliga"],
];

export const TAXONOMY_TREE: TaxNode[] = [
  category("sports", "Sports", [
    ["nfl", "NFL"], ["cfb", "College football"], ["nba", "NBA"], ["ncaab", "College basketball"],
    ["soccer", "Soccer", ["soccer"], SOCCER],
    ["nhl", "Hockey"], ["mlb", "Baseball"],
    ["tennis", "Tennis", ["tennis"], [["atp", "ATP"], ["wta", "WTA"]]],
    ["esports", "Esports", ["esports"], [["counter-strike-2", "Counter-Strike 2"], ["dota-2", "Dota 2"], ["league-of-legends", "League of Legends"], ["valorant", "Valorant"]]],
    ["ufc", "UFC"], ["boxing", "Boxing"], ["golf", "Golf"], ["f1", "Formula 1"], ["cricket", "Cricket"],
  ]),
  category("crypto", "Crypto", [
    ["bitcoin", "Bitcoin"], ["ethereum", "Ethereum"], ["solana", "Solana"], ["xrp", "XRP"],
    ["up-or-down", "Up or down"], ["hit-price", "Hit a price"], ["multi-strikes", "Price ranges"],
  ]),
  category("weather", "Weather & Climate", [
    ["highest-temperature", "Highest temperature"], ["lowest-temperature", "Lowest temperature"],
    ["precipitation", "Rain & snow", ["precipitation", "rain", "snow"]], ["hurricanes", "Hurricanes", ["hurricanes", "hurricane"]],
  ]),
  category("finance", "Finance & Economics", [
    ["stocks", "Stocks", ["stocks", "equities", "stock-prices"]], ["earnings-calls", "Earnings calls"],
    ["commodities", "Commodities", ["commodities", "gold", "silver", "oil"]], ["fed", "Fed"],
    ["inflation", "Inflation"], ["jobs", "Jobs"], ["daily-close", "Daily close"], ["finance-updown", "Up or down"],
  ]),
  category("politics", "Politics & Elections", [
    ["elections", "Elections"], ["us-politics", "US", ["us-politics", "us-election"]], ["congress", "Congress"],
    ["courts", "Courts", ["courts", "scotus"]], ["trump", "Trump admin", ["trump", "trump-presidency"]],
  ]),
  category("geopolitics", "World"),
  category("culture", "Culture", [
    ["awards", "Awards"], ["music", "Music"], ["movies", "Movies"], ["celebrities", "Celebrities"],
    ["tweets-markets", "Tweets"], ["top-netflix", "Netflix"], ["art-auction", "Art auctions"],
  ]),
  category("tech", "Tech & Science", [
    ["ai", "AI", ["ai", "ai-releases"]], ["big-tech", "Big Tech"], ["openai", "OpenAI"], ["anthropic", "Anthropic"],
    ["google", "Google"], ["nvda", "Nvidia"],
  ]),
  category("mentions", "Mentions", [], (m) => m.tags.includes("mention-markets")),
  category("other", "Other"),
];

/** Flat id → node map. */
export const TAXONOMY: Record<string, TaxNode> = {};
(function walk(nodes: TaxNode[]) {
  for (const n of nodes) {
    TAXONOMY[n.id] = n;
    if (n.children) walk(n.children);
  }
})(TAXONOMY_TREE);

const cache = new WeakMap<Market, Set<string>>();
/** All taxonomy ids a market belongs to (memoised per market object). */
export function topicsOf(m: Market): Set<string> {
  let ids = cache.get(m);
  if (!ids) {
    ids = new Set();
    const visit = (nodes: TaxNode[]) => {
      for (const n of nodes) if (n.match(m)) { ids!.add(n.id); if (n.children) visit(n.children); }
    };
    visit(TAXONOMY_TREE);
    cache.set(m, ids);
  }
  return ids;
}
