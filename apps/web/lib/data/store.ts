// In-memory data store (docs/02 § Data flow): one parsed copy per server instance, 120 s cache,
// concurrent loads de-duplicated. Server only — never ship markets.json to the browser.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import "server-only";
import { after } from "next/server";
import { DATA_SOURCE, dataDirSetting, type DataSource } from "@/lib/config";
import type { Tier } from "@/lib/entitlements";
import { getSettings } from "@/lib/settings";
import { delayMin } from "@/lib/settings-core";
import { Flag as FlagSchema, Market as MarketSchema, ScanMeta as MetaSchema } from "@/lib/schemas";
import type { BacktestFile, EventsFile, FlagsFile, KalshiFile, LedgerSummary, MarketsFile, ModelFile, ScanMeta, StoreMarket } from "@/lib/types";
import { derive } from "./derive";
import { buildSearch, type SearchIndex } from "@/lib/search/index";
import { DELAYED_PENDING } from "@/lib/api";

/** Free can't be served yet: no older scan to show inside the delay window (docs/15). Pages render an honest
 *  "first update shortly" state and the API answers 503; Free never falls through to the live scan. */
export class DelayedPending extends Error {
  readonly code = DELAYED_PENDING;
}

export interface RawData {
  markets: MarketsFile;
  flags: FlagsFile;
  model: ModelFile;
  backtest: BacktestFile;
  events?: EventsFile;              // output/events.json (T-05), optional
  ledgerSummary?: LedgerSummary;    // output/ledger_summary.json (T-04), optional
  ledgerSince?: number | null;      // first flagged_at in output/ledger.jsonl (T-290), the live record's start
  source?: DataSource;              // which source served this copy
}

type Counts = Record<string, number>;

export interface Store {
  loadedAt: number;
  meta: ScanMeta;
  markets: StoreMarket[];
  flags: StoreMarket[];                     // flags.json rows (always carry `execution`)
  byId: Map<string, StoreMarket>;
  byEvent: Map<string, StoreMarket[]>;
  bySlug: Map<string, StoreMarket[]>;       // event slug → markets
  flagsById: Map<string, StoreMarket>;
  facets: { categories: Counts; niches: Counts; market_types: Counts; periods: Counts; frequency: Counts };
  search: SearchIndex;
  model: ModelFile;
  backtest: BacktestFile;
  events?: EventsFile;
  ledgerSummary?: LedgerSummary;
  ledgerSince?: number | null;
  source?: DataSource;
}

const github = () => ({
  token: process.env.GITHUB_DATA_TOKEN,
  // GITHUB_DATA_REPO, else the repo Vercel deployed from (system env vars, on by default).
  repo: process.env.GITHUB_DATA_REPO
    || (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : ""),
  ref: process.env.GITHUB_DATA_REF || "live",
});

/** The service key never leaves the server (this file is server-only; no NEXT_PUBLIC_ prefix). */
const supabaseStorage = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, ""),
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket: "scan",
});

const TTL_MS = 120_000;
const dataDir = () => path.resolve(process.cwd(), dataDirSetting());

const push = <K, V>(map: Map<K, V[]>, k: K, v: V) => {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
};
const inc = (c: Counts, k: string) => (c[k] = (c[k] ?? 0) + 1);

/** Validate meta + ~1% of rows; log problems, never throw. */
function validate(file: string, meta: unknown, rows: unknown[], schema: typeof MarketSchema | typeof FlagSchema) {
  const m = MetaSchema.safeParse(meta);
  if (!m.success) console.warn(`[store] ${file} meta mismatch`, m.error.issues.slice(0, 3));
  let bad = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const r = schema.safeParse(rows[i]);
    if (!r.success && bad++ < 3) console.warn(`[store] ${file} row ${i} mismatch`, r.error.issues.slice(0, 3));
  }
}

export function buildStore(raw: RawData, loadedAt = Date.now()): Store {
  validate("markets.json", raw.markets.meta, raw.markets.markets, MarketSchema);
  validate("flags.json", raw.flags.meta, raw.flags.flags, FlagSchema);

  const flags: StoreMarket[] = raw.flags.flags.map((f) => ({ ...f, derived: derive(f) }));
  const flagsById = new Map(flags.map((f) => [f.id, f]));
  const markets: StoreMarket[] = raw.markets.markets.map((m) => {
    const flag = flagsById.get(m.id);
    const execution = (m as StoreMarket).execution ?? flag?.execution;
    return { ...m, ...(execution ? { execution } : {}), ...(flag ? { tier: flag.tier ?? "best" } : {}), derived: derive(m) };
  });

  const byId = new Map<string, StoreMarket>();
  const byEvent = new Map<string, StoreMarket[]>();
  const bySlug = new Map<string, StoreMarket[]>();
  const facets: Store["facets"] = { categories: {}, niches: {}, market_types: {}, periods: {}, frequency: {} };
  for (const m of markets) {
    byId.set(m.id, m);
    push(byEvent, m.event_id, m);
    push(bySlug, m.slug.toLowerCase(), m);
    inc(facets.categories, m.category);
    inc(facets.niches, m.niche);
    inc(facets.market_types, m.market_type);
    inc(facets.periods, m.derived.period);
    for (const f of m.derived.frequency) inc(facets.frequency, f);
  }

  return {
    loadedAt,
    meta: raw.markets.meta,
    markets,
    flags,
    byId,
    byEvent,
    bySlug,
    flagsById,
    facets,
    search: buildSearch(markets, bySlug),
    model: raw.model,
    backtest: raw.backtest,
    events: raw.events,
    ledgerSummary: raw.ledgerSummary,
    ledgerSince: raw.ledgerSince ?? null,
    source: raw.source,
  };
}

/** Sources tried in order (docs/14 §4): supabase → GitHub `live` branch; getStore adds the last good copy. */
export const sourceChain = (s: DataSource = DATA_SOURCE): DataSource[] => (s === "supabase" ? ["supabase", "github"] : [s]);

const inflate = promisify(gunzip);

/** T-277: ops/upload.py stores objects gzip-compressed under their usual names, without Content-Encoding.
 *  Sniff the gzip magic bytes (1f 8b) on the raw bytes: gzip → inflate, anything else is plain UTF-8 (objects from
 *  before the rollout, the GitHub live branch, local files, or a response an HTTP layer already decoded).
 *  JSON text never starts with 0x1f, so the sniff can't misread a plain file. */
export async function decodeBody(bytes: Uint8Array): Promise<string> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? await inflate(buf) : buf).toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;   // drop a BOM, as Response.text() did
}

/** #46 (Nov 20): one slow Storage response used to hold a load for 30 s and then hand the instance to the stale
 *  fallback. Two tries with shorter timeouts: a stuck connection is dropped and retried on a fresh one. */
const TRIES_MS = [15_000, 20_000];

async function fetchText(url: string, headers: Record<string, string>, missing: number[]) {
  let err: unknown;
  for (const ms of TRIES_MS) {
    try {
      const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(ms) });
      if (missing.includes(res.status)) return undefined;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await decodeBody(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      err = e;
      if (/^HTTP 4\d\d/.test((e as Error).message)) break;   // a 4xx won't change on retry
    }
  }
  throw err;
}

/** One file from one source; undefined = the source has no such file. */
async function readFrom(source: DataSource, file: string): Promise<string | undefined> {
  if (source === "supabase") {
    const { url, key, bucket } = supabaseStorage();
    if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    // Storage answers 400 (not 404) for a missing object.
    return fetchText(`${url}/storage/v1/object/authenticated/${bucket}/${file}`, { Authorization: `Bearer ${key}`, apikey: key }, [400, 404]);
  }
  if (source === "github") {
    const { token, repo, ref } = github();
    return fetchText(`https://api.github.com/repos/${repo}/contents/${file}?ref=${ref}`,
      { Accept: "application/vnd.github.raw", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, [404]);
  }
  try {
    return await decodeBody(await readFile(path.join(dataDir(), file)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** One file from the first source that has it. */
export async function readSource(file: string, chain = sourceChain()): Promise<string | undefined> {
  let err: unknown;
  for (const source of chain) {
    try {
      const text = await readFrom(source, file);
      if (text !== undefined) return text;
    } catch (e) {
      err = e;
      console.warn(`[store] ${source} ${file} failed: ${(e as Error).message}`);
    }
  }
  if (err) throw err;
  return undefined;
}

async function loadFrom(source: DataSource): Promise<RawData> {
  const read = async <T>(file: string, required: boolean): Promise<T | undefined> => {
    const text = await readFrom(source, file);
    if (text === undefined && required) throw new Error(`missing ${file} (DATA_SOURCE=${source}, dir=${dataDir()})`);
    return text === undefined ? undefined : (JSON.parse(text) as T);
  };
  const [markets, flags, model, backtest, events, ledgerSummary] = await Promise.all([
    read<MarketsFile>("markets.json", true),
    read<FlagsFile>("flags.json", true),
    read<ModelFile>("model.json", true),
    read<BacktestFile>("backtest.json", true),
    read<EventsFile>("events.json", false),
    read<LedgerSummary>("ledger_summary.json", false),
  ]);
  // QA-A #46: the publisher uploads markets.json and flags.json about a second apart, so a load that lands between
  // them would pair one scan's markets with the other scan's flags. Refuse it; the caller keeps its copy and retries.
  if (markets!.meta.scanned_at !== flags!.meta.scanned_at) {
    throw new Error(`torn load: markets.json scan ${markets!.meta.scanned_at} vs flags.json scan ${flags!.meta.scanned_at}`);
  }
  const ledgerSince = ledgerSummary ? await firstFlaggedAt(source).catch(() => null) : null;
  return { markets: markets!, flags: flags!, model: model!, backtest: backtest!, events, ledgerSummary, ledgerSince, source };
}

const sinceMemo = new Map<DataSource, number>();
/** T-290: when the live record started: the first flagged_at in ledger.jsonl (append-only, oldest first, but scan
 *  it all in case). The start never changes, so it is read once per source per instance; until a ledger has a first
 *  entry it is re-read with each store load. */
export async function firstFlaggedAt(source: DataSource): Promise<number | null> {
  const hit = sinceMemo.get(source);
  if (hit !== undefined) return hit;
  const text = await readFrom(source, "ledger.jsonl");
  let min: number | null = null;
  for (const line of text?.split("\n") ?? []) {
    if (!line.trim()) continue;
    try {
      const t = (JSON.parse(line) as { flagged_at?: unknown }).flagged_at;
      if (typeof t === "number" && Number.isFinite(t) && (min === null || t < min)) min = t;
    } catch { /* a torn last line while the grader writes: skip it */ }
  }
  if (min !== null) sinceMemo.set(source, min);
  return min;
}

/** #46 (Nov 20): a fallback source is only used while it is this fresh. The GitHub `live` branch stopped updating when
 *  the engine moved to Railway, and instances that fell back to it served a day-old scan beside fresh ones. */
export const FALLBACK_MAX_AGE_S = 2 * 3600;

/** Every file from one source (never mix two scans); on any failure the next source, if its scan is recent. */
export async function loadRaw(chain = sourceChain(), now = Date.now() / 1000): Promise<RawData> {
  let err: unknown;
  for (const [i, source] of chain.entries()) {
    try {
      const raw = await loadFrom(source);
      const age = now - raw.markets.meta.scanned_at;
      if (i > 0 && age > FALLBACK_MAX_AGE_S) throw new Error(`fallback scan is ${Math.round(age / 3600)} h old, not used`);
      return raw;
    } catch (e) {
      err = e;
      console.warn(`[store] ${source} load failed: ${(e as Error).message}`);
    }
  }
  throw new Error(`[store] no data source answered: ${(err as Error)?.message}`);
}

const RETRY_MS = 30_000;
/** QA-A #46/#60 (Nov 21): stale-while-revalidate had no age limit, so the first request to an instance that sat idle
 *  for an hour got the hour-old scan (and its header, fetched from a busier instance, a newer one). A copy confirmed
 *  current in the last SWR_MAX_MS is served at once while it refreshes; an older one waits for the reload, at most
 *  WAIT_MS (a stuck download can take 35 s), then falls back to the copy in hand. Scans run every ~15 min. */
export const SWR_MAX_MS = 5 * 60_000;
export const WAIT_MS = 10_000;

/** Nov 20: the background refresh above ran after the response was sent, and Vercel freezes a function once its response
 *  is out, so the ~20 MB download stalled mid-stream and died as "aborted due to timeout" / "terminated" (about half
 *  of all loads in the logs). after() keeps the function running until the refresh settles. Outside a request (tests,
 *  scripts) after() throws; there nothing freezes, so the promise just runs. */
function keepAlive(p: Promise<unknown>) {
  try { after(() => p.then(() => {}, () => {})); } catch { /* no request scope */ }
}

// Kept on globalThis so dev hot reloads don't re-parse 20 MB each time.
const g = globalThis as unknown as {
  __meStore?: { cache?: Store; inflight?: Promise<Store>; failedAt?: number; prev?: Store; prev2?: Store; delayed?: { for: number; load: Promise<void> } };
};
const state = (g.__meStore ??= {});

/** Tests: swap the loader and reset this instance's copies. */
let loader: () => Promise<RawData> = () => loadRaw();
export function _resetStore(load?: () => Promise<RawData>) {
  loader = load ?? (() => loadRaw());
  for (const k of Object.keys(state) as (keyof typeof state)[]) delete state[k];
}

/** The reload, or the copy in hand if the reload fails or takes longer than WAIT_MS. */
function waitOrCopy(load: Promise<Store>, copy: Store): Promise<Store> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Store>((resolve) => { timer = setTimeout(() => resolve(copy), WAIT_MS); });
  return Promise.race([load.catch(() => copy), timeout]).finally(() => clearTimeout(timer));
}

export function getStore(): Promise<Store> {
  const age = state.cache ? Date.now() - state.cache.loadedAt : Infinity;
  if (state.cache && age < TTL_MS) return Promise.resolve(state.cache);
  if (state.inflight) return !state.cache ? state.inflight : age < SWR_MAX_MS ? Promise.resolve(state.cache) : waitOrCopy(state.inflight, state.cache);
  // While every source is down, serve the last good copy and retry at most every 30 s.
  if (state.cache && state.failedAt && Date.now() - state.failedAt < RETRY_MS) return Promise.resolve(state.cache);
  state.inflight = loader()
    .then((raw) => {
      state.failedAt = undefined;
      // #46: never swap the copy in hand for an older scan (a lagging source or a stale object)
      if (state.cache && raw.markets.meta.scanned_at < state.cache.meta.scanned_at) {
        state.cache.loadedAt = Date.now();
        return state.cache;
      }
      if (state.cache && raw.markets.meta.scanned_at === state.cache.meta.scanned_at) {
        state.cache.loadedAt = Date.now();   // same scan: keep the parsed copy (and its derived indexes)
        return state.cache;
      }
      const next = buildStore(raw);
      // QA-A #46: a copy kept as `prev` feeds the Free delay. Only one confirmed current recently is a scan or two
      // behind; one that sat unrefreshed may be many scans back, so drop it and let the published *-prev files decide.
      if (state.cache && state.cache.meta.scanned_at !== next.meta.scanned_at) {
        if (Date.now() - state.cache.loadedAt < SWR_MAX_MS) [state.prev2, state.prev] = [state.prev, state.cache];
        else [state.prev2, state.prev, state.delayed] = [undefined, undefined, undefined];
      }
      return (state.cache = next);
    })
    .catch((e) => { state.failedAt = Date.now(); throw e; })
    .finally(() => (state.inflight = undefined));
  if (!state.cache) return state.inflight;
  // Stale-while-revalidate (docs/19 P6): with a recent copy in hand, answer now and let the ~20 MB reload finish in the
  // background, so no request waits on it. A failed refresh keeps serving the previous copy.
  state.inflight.catch(() => {});
  keepAlive(state.inflight);
  return age < SWR_MAX_MS ? Promise.resolve(state.cache) : waitOrCopy(state.inflight, state.cache);
}

/** One delayed copy (`*-prev.json` or `*-prev2.json`, which the publishers keep: engine scan_keeping_prev,
 *  ops/upload.py, refresh.yml) on the same source as `s`. Model, backtest and events are the newest (they carry no live
 *  prices). undefined when the copy is missing or not older than `s`. */
async function loadCopy(s: Store, suffix: "prev" | "prev2"): Promise<Store | undefined> {
  const chain = sourceChain(s.source ?? DATA_SOURCE);
  const read = async <T>(file: string) => {
    const text = await readSource(file, chain);
    return text === undefined ? undefined : (JSON.parse(text) as T);
  };
  const [markets, flags] = await Promise.all([read<MarketsFile>(`markets-${suffix}.json`), read<FlagsFile>(`flags-${suffix}.json`)]);
  if (!markets || !flags || !(markets.meta.scanned_at < s.meta.scanned_at)) return undefined;
  if (flags.meta.scanned_at !== markets.meta.scanned_at) return undefined;   // QA-A #46: a torn pair, mid-upload
  // #46: a delayed copy is a scan or two behind, never a day-old one from a stale fallback source
  if (s.meta.scanned_at - markets.meta.scanned_at > FALLBACK_MAX_AGE_S) return undefined;
  return buildStore({ markets, flags, model: s.model, backtest: s.backtest, events: s.events, ledgerSummary: s.ledgerSummary, ledgerSince: s.ledgerSince, source: s.source });
}

/** Newest of the stores at or before `cutoff` (unix s). */
const newestBy = (cutoff: number, ...stores: (Store | undefined)[]) =>
  stores.filter((x): x is Store => !!x && x.meta.scanned_at <= cutoff).sort((a, b) => b.meta.scanned_at - a.meta.scanned_at)[0];

/** Free data is at least delayMin("free") behind (site settings, default 15) (docs/08, docs/15): Free gets the newest
 *  scan whose scanned_at is at least the delay before now (RT3-03: "the scan before" is not enough when scans run more
 *  often than the delay). Candidates: the newest scan itself, this instance's two previous copies, else the published
 *  `*-prev.json` / `*-prev2.json` (so a cold instance holds the delay too; prev2 is read only when prev is too young).
 *  None old enough = throw DelayedPending (routes answer 503, pages show the pending state): Free never gets a younger scan.
 *  ponytail: two copies cover a cadence down to half the delay (10 min for 15); a burst of back-to-back scans can leave
 *  a few minutes of pending state until one ages past the delay. Keep more copies if scans ever run that often. */
export async function getStoreFor(tier: Tier): Promise<Store> {
  const [s] = await Promise.all([getStore(), getSettings()]);   // getSettings refreshes the Free rows/delay snapshot
  const delay = delayMin(tier);
  const cutoff = Date.now() / 1000 - delay * 60;
  if (delay === 0) return s;
  const pick = () => newestBy(cutoff, s, state.prev, state.prev2);
  const hit = pick();
  if (hit) return hit;
  const at = s.meta.scanned_at;
  if (state.delayed?.for !== at) {
    // Published copies, read once per newest scan: kept in memory as prev / prev2 so they age into eligibility.
    const load = (async () => {
      const prev = await loadCopy(s, "prev");
      const keep = (c: Store | undefined) => {
        if (c && !(state.prev?.meta.scanned_at === c.meta.scanned_at || state.prev2?.meta.scanned_at === c.meta.scanned_at)) {
          if (!state.prev || c.meta.scanned_at > state.prev.meta.scanned_at) [state.prev2, state.prev] = [state.prev, c];
          else if (!state.prev2 || c.meta.scanned_at > state.prev2.meta.scanned_at) state.prev2 = c;
        }
      };
      keep(prev);
      if (!prev || prev.meta.scanned_at > cutoff) keep(await loadCopy(s, "prev2"));
    })();
    state.delayed = { for: at, load };
    load.catch(() => { if (state.delayed?.load === load) state.delayed = undefined; });   // retry on the next request
  }
  await state.delayed!.load;
  const late = pick();
  if (late) return late;
  throw new DelayedPending(`[store] no scan at least ${delay} min old yet: Free tier can't be served`);
}

/** output/kalshi.json (docs/03 § kalshi.json): optional, own 120 s cache, markets sorted by volume. Missing = undefined.
 *  Callers check KALSHI_DATA_PERMISSION first (kalshiDataEnabled in lib/kalshiCombo). */
const kalshi: { at?: number; data?: KalshiFile; inflight?: Promise<KalshiFile | undefined> } = {};
export function getKalshi(): Promise<KalshiFile | undefined> {
  if (kalshi.at && Date.now() - kalshi.at < TTL_MS) return Promise.resolve(kalshi.data);
  return (kalshi.inflight ??= readSource("kalshi.json")
    .then((text) => {
      const f = text === undefined ? undefined : (JSON.parse(text) as KalshiFile);
      f?.markets.sort((a, b) => b.volume - a.volume);
      return (kalshi.data = f);
    })
    .catch((e) => { console.warn(`[store] kalshi.json failed: ${(e as Error).message}`); return kalshi.data; })
    .finally(() => { kalshi.at = Date.now(); kalshi.inflight = undefined; }));
}
