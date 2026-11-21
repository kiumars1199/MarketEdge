# 13 · Search & filters v2 (feedback from Q, Nov 16 night)

Three changes, in this order:
1. **Home = Best bets.** `/` shows Best bets. The landing page moves to `/about` ("How it works" link in
   the header and footer).
2. **Smart search** that understands what people type ("barcelona 3x good edge") and suggests results
   letter by letter.
3. **Simple filters**: five plain-language dropdowns on top; everything else behind "More filters".

Casual bettors think in **multipliers** ("3x"), not cents. Add multipliers everywhere:
`pays = 1 / ask` (gross payout per $1 staked, before fee), shown as **"Pays 3.0x"** on every card,
row and drawer next to the price.

---

## 1. Smart search

### What it must handle (acceptance examples — make these Vitest cases)
| Typed | Parsed into | Shows |
|---|---|---|
| `barcelona 3x good edge` | text "barcelona" · pays ≈ 3x · return ≥ 10% | Barcelona markets paying 2.6–3.5x with ≥ 10% expected return |
| `barca 3x` | alias barca→barcelona · pays ≈ 3x | same without the return filter |
| `nfl favorites tomorrow` | topic NFL · side favorite · closes tomorrow | |
| `over 2.5 goals` | text "over 2.5" · topic soccer (totals) | Over 2.5 goals markets |
| `nyc weather` / `highest temp london` | topic weather · city New York / London | |
| `safe bets` | chance ≥ 80% | |
| `long shots 5x+` | pays ≥ 5x | (long-shot floor lifted) |
| `lakers +200` | text "lakers" · pays ≈ 3x (American +200 = 3.0x) | |
| `bitcoin today` | topic bitcoin · closes today | |
| `under 40c` / `below 40¢` | price ≤ 40¢ | |
| `60% chance` / `likely` | chance ≥ 60% / ≥ 80% | |
| `ufc tonight best` | topic UFC · closes tonight · sort best return | |
| `barcelna` (typo) | fuzzy → barcelona | |
| a pasted Polymarket URL | slug match (exists today) | |

### Grammar (parser in `lib/search/parse.ts`, pure function, runs on server AND client)
Tokens are pulled out left to right; whatever is left is free text.
| Kind | Patterns | Becomes |
|---|---|---|
| Multiplier | `3x`, `x3`, `3.5x`, `3x+` / `3x or more`, `under 2x`, `2-3x` | `pays` range: exact N → [0.87N, 1.15N]; `N+` → [N, ∞); `under N` → [1, N] |
| American odds | `+200`, `-150` | converted to multiplier (+200 → 3.0x; −150 → 1.67x), same ranges |
| Decimal odds | `@2.5`, `2.5 odds` | multiplier |
| Price | `40c`, `40¢`, `under 40c`, `below 40 cents` | ask range |
| Chance | `60%`, `60% chance`, `likely` (≥80), `safe` (≥80), `coin flip` (40–55), `long shot(s)` (< 40) | win_prob range |
| Return / quality | `good`, `good edge`, `good value` (≥10%), `great`/`best` (≥20%, sort return), `+15%`, `15% return` | roi min |
| Time | `today`, `tonight` (closes before 4 AM local), `tomorrow`, `this week`, `this weekend`, `live`, `in 6 hours` | closes window (user's timezone) |
| Side | `yes`, `no`, `favorite(s)`, `underdog(s)`, `over`, `under` (when followed by a number, keep as text: `under 2.5`) | side filter or text |
| Market type | `moneyline`/`ml`/`to win`, `spread`, `total`/`o/u`, `btts`/`both teams to score`, `prop(s)`, `1h`/`first half`, `1q` | market_type / period |
| Topic | taxonomy labels + aliases (below) | topic ids |
| City | weather city names from data | topic weather + text city |
| Sort words | `best`, `highest return`, `safest`, `soonest`, `newest` | sort |

Aliases (`lib/search/aliases.ts`, data-driven, easy to extend):
`barca→barcelona, man u/man utd→manchester united, man city→manchester city, spurs→tottenham (soccer)/san antonio (nba by context), psg→paris saint-germain, real→real madrid, nyc/new york city→new york, la→los angeles, sf→san francisco, epl/prem→premier league, ucl/champions→champions league, cfb/college football→cfb, ncaab/college basketball, btc→bitcoin, eth→ethereum, sol→solana, temp/temperature→weather, ufc/mma, f1/formula 1, cs/cs2/counter strike, lol/league, dota`.
Also auto-generate aliases from the data at load: team names from outcomes and event titles ("Barcelona",
"FC Barcelona"), cities from weather questions, player names from props.

```ts
type ParsedQuery = {
  text: string[]                 // leftover words, matched fuzzily
  pays?: [number, number]; price?: [number, number]; chance?: [number, number]
  roiMin?: number; closes?: { from: number; to: number }; side?: Side; marketTypes?: MarketType[]
  periods?: Period[]; topics?: string[]; sort?: SortKey
  chips: { kind: string; label: string; remove: Partial<ParsedQuery> }[]   // for display
  liftsLongShotFloor: boolean    // true if pays ≥ 2x, price < 40c, chance < 40%, or "long shot"
}
parse(q: string, ctx: { aliases, topics, cities, now, tz }): ParsedQuery
toFilterState(p: ParsedQuery, base: FilterState): FilterState   // merges into the normal filter system
```
The parsed parts appear as **chips under the search box** ("Barcelona · Pays ~3x · Return 10%+"),
each removable, so the user sees how they were understood and can fix it. Clicking a chip opens the
matching filter dropdown.

### Matching and ranking (`lib/search/index.ts`, server)
- Replace the AND-substring index with **MiniSearch** (prefix + fuzzy: edit distance 1 for words ≥ 5
  letters, 2 for ≥ 9) over: question (boost 3), event (2), outcomes (2), team/player/city entities (3),
  tags + niche + topic labels (1), aliases expanded at index time.
- Score = text score × (1 + 0.5 × normalized expected return) + small bonus if closing within 24 h.
  When the query has a sort word, sort by that instead.
- Long-shot floor: the default "chance ≥ 40%" filter is lifted when `liftsLongShotFloor` is true
  (a "3x" bet is about a 33% chance, so the floor would hide everything the user asked for).

### No exact match → honest fallback
If the full parsed query returns nothing, relax in this order and say so: drop return → widen pays to
±30% → drop time → text only. Banner: "No 3x Barcelona bets look good right now. Showing all Barcelona
bets paying 2–4x, best first." Never pretend a relaxed result matches.
Important context for the copy: the model mostly finds value in **favorites**, so high-multiplier
searches will often hit this fallback. That's correct behaviour, not a bug.

### Suggestions as you type (`components/search/SearchCombobox.tsx` + `/api/suggest?q=`)
- Opens on focus (shows recent searches + saved views + popular topics). Updates on every keystroke,
  debounced 80 ms; target < 50 ms server time; abort the previous request.
- Groups (max total 10 rows): **Teams & players** (entity, count of open markets, best return among them) ·
  **Topics** (NFL, Weather …) · **Markets** (top 4 matches: question, Pays Nx, return %) · **Your saved views**
  · bottom row "Search all markets for 'barc…'" (Enter).
- Shows the interpretation line as you type: "Barcelona · Pays ~3x".
- Keyboard: ↑/↓, Enter, Esc, Tab completes the highlighted entity. Mobile: full-screen search sheet.
- Highlight the matched letters. Recent searches stored locally (last 8), clearable.
- Selecting a team/topic adds it as a chip; selecting a market opens its drawer.
- The URL keeps the raw query (`?q=barcelona+3x+good+edge`) so searches are shareable and savable as views.

## 2. Simple filters

Replace the sidebar on Best bets with **one row of five dropdown pills** under the search box. Each
dropdown has 4–6 big choices with counts, not sliders:

| Pill | Choices |
|---|---|
| **Topic** | searchable list with counts, favorites pinned; multi-select |
| **Pays** | Any · Under 1.5x (safest) · 1.5–2x · 2–3x · 3–5x · 5x+ (long shots) |
| **Chance** | Any · Likely (80%+) · Leans your way (55–80%) · Coin flip (40–55%) · Long shot (under 40%) |
| **Return** | Any · 5%+ · 10%+ · 20%+ |
| **Closes** | Any time · Next 6 hours · Today · Tomorrow · This week |

Plus: **Sort** (Best return · Most likely · Closing soon · Biggest payout) and **More filters** (opens the
existing full panel as a sheet: market type, period, side, volume, liquidity, spread, price check, evidence,
validated, live, frequency). Applied filters show as removable pills with a "Clear all".
All Markets keeps the same five pills + More filters (no permanent sidebar). Every pill maps onto the
existing `FilterState` (add `pays_min`/`pays_max`; derive from `price` bounds on the server).

## 3. Card and row changes
- Add **"Pays 3.0x"** next to the price everywhere (cards, rows, drawer, extension badge).
- Default sort on Best bets stays "Best return" with the 40% chance floor; the floor chip is visible and
  removable ("Hiding long shots · Show").

## Done when
- All rows of the examples table pass as Vitest cases (parse → expected FilterState) and 6 of them as
  Playwright flows (type → suggestions appear within 300 ms → results match).
- Typing "bar" shows Barcelona (and other matches) in the dropdown on the 3rd letter.
- `/` renders Best bets; `/about` renders the old landing; nav and links updated; e2e S1 updated.
- A first-time tester can find "Barcelona bets paying about 3x" without touching More filters.
