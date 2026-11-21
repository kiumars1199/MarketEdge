// Search aliases (docs/13 § Aliases). Plain data: add a row to extend. Keys are lowercase phrases matched as
// whole words, longest first. Team and city names that appear in the data need no alias (the index has them).
import { TAXONOMY } from "@/lib/taxonomy";

/** Phrase → the words it stands for in market text. */
export const TEXT_ALIASES: Record<string, string> = {
  barca: "barcelona",
  "man u": "manchester united", "man utd": "manchester united", "man united": "manchester united",
  "man city": "manchester city",
  psg: "paris saint-germain",
  real: "real madrid", "real madrid": "real madrid",
  nyc: "new york", "new york city": "new york",
  la: "los angeles",
  sf: "san francisco",
  btts: "both teams to score",
};

/** "spurs" depends on the sport: Tottenham in soccer, San Antonio in the NBA (default soccer). */
export const CONTEXT_ALIASES: Record<string, { default: string; byTopic: Record<string, string> }> = {
  spurs: { default: "tottenham", byTopic: { "sports.nba": "san antonio" } },
};

/** Phrase → taxonomy id. Taxonomy labels and slugs ("nfl", "college football", "bitcoin") are added below. */
export const TOPIC_ALIASES: Record<string, string> = {
  epl: "sports.soccer.premier-league", prem: "sports.soccer.premier-league",
  ucl: "sports.soccer.ucl", champions: "sports.soccer.ucl",
  ncaaf: "sports.cfb", "college basketball": "sports.ncaab", "march madness": "sports.ncaab",
  football: "sports.nfl", basketball: "sports.nba", hockey: "sports.nhl", baseball: "sports.mlb",
  goals: "sports.soccer",
  btc: "crypto.bitcoin", eth: "crypto.ethereum", sol: "crypto.solana",
  temp: "weather", temps: "weather", temperature: "weather", weather: "weather", forecast: "weather",
  rain: "weather.precipitation", snow: "weather.precipitation",
  ufc: "sports.ufc", mma: "sports.ufc",
  f1: "sports.f1", "formula 1": "sports.f1", "formula one": "sports.f1",
  cs: "sports.esports.counter-strike-2", cs2: "sports.esports.counter-strike-2", "counter strike": "sports.esports.counter-strike-2",
  "counter-strike": "sports.esports.counter-strike-2",
  lol: "sports.esports.league-of-legends", league: "sports.esports.league-of-legends",
  dota: "sports.esports.dota-2", dota2: "sports.esports.dota-2",
  fed: "finance.fed", stocks: "finance.stocks", stock: "finance.stocks",
};

// Labels and slugs from the taxonomy, so a new topic is searchable without touching this file.
// Two-letter labels ("US") and "other" are skipped; an explicit alias above always wins.
for (const [id, node] of Object.entries(TAXONOMY)) {
  const slug = id.split(".").at(-1)!.replace(/-/g, " ");
  for (const k of [node.label.toLowerCase().replace(/ & /g, " and "), node.label.toLowerCase().split(" & ")[0]!, slug]) {
    if (k.length < 3 && k !== "ai") continue;
    if (k === "other" || k in TOPIC_ALIASES) continue;
    TOPIC_ALIASES[k] = id;
  }
}
