"use client";

// Screener state: the URL is the only source of truth (lib/filters/url.ts); data comes from lib/api.ts.
import { usePathname, useSearchParams } from "next/navigation";
import { softNav } from "@/lib/softNav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchFlags, fetchMarkets, fetchMeta, type MarketsResponse, type MetaResponse } from "@/lib/api";
import { resolveUserFilters } from "@/lib/filters/user";
import type { FilterState } from "@/lib/filters/state";
import { parse, serialize } from "@/lib/filters/url";
import { useCollection, useProfile } from "@/lib/repo/hooks";

export type Mode = "markets" | "flags";

import { BEST_BETS_VERDICTS } from "@/lib/filters/state";
export { BEST_BETS_VERDICTS };

function stateFrom(params: URLSearchParams, mode: Mode): FilterState {
  const s = parse(params);
  if (mode === "markets") return s;
  return {
    ...s,
    view: "flags",
    verdicts: params.has("vd") ? s.verdicts : BEST_BETS_VERDICTS,
  };
}

/** Query string for a state on a page; Best bets omits its own defaults so its URL stays short. */
export function queryFor(s: FilterState, mode: Mode): string {
  const p = serialize(s);
  if (mode === "flags") {
    p.delete("view");
    if (p.get("vd") === BEST_BETS_VERDICTS.join(",")) p.delete("vd");
  }
  const q = p.toString();
  return q ? `?${q}` : "";
}

// Scan meta changes at most once per scan; one request per page load is enough.
let metaPromise: Promise<MetaResponse> | null = null;
export function useMeta() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  useEffect(() => {
    let live = true;
    (metaPromise ??= fetchMeta().catch((e) => ((metaPromise = null), Promise.reject(e))))
      .then((m) => live && setMeta(m))
      .catch(() => {});
    return () => void (live = false);
  }, []);
  return meta;
}

/** `extra`: server pages appended by "Show more" after `data` (QA-A #71: counted, not inferred from row counts, which
 *  live re-pricing can shrink below a full page). */
type Result = { key: string; data?: MarketsResponse; more?: MarketsResponse["rows"]; moreGroups?: NonNullable<MarketsResponse["groups"]>; extra?: number; error?: string };

/** `initial`: the server-rendered first page for the URL the page loaded with; used instead of the first fetch. */
export function useScreener(mode: Mode, initial?: MarketsResponse) {
  const params = useSearchParams();
  const pathname = usePathname();

  // drawer params (m, side) don't change the list
  const key = useMemo(() => {
    const p = new URLSearchParams(params);
    p.delete("m");
    p.delete("side");
    return p.toString();
  }, [params]);
  const state = useMemo(() => stateFrom(new URLSearchParams(key), mode), [key, mode]);

  const watchlist = useCollection("watchlist");
  const profile = useProfile();
  // "Mine" filters resolve in the browser (lib/filters/user.ts): favorites → topics, watchlist → keep().
  const watchKey = state.watchlisted_only ? watchlist.map((w) => w.market_id).join(",") : "";
  const favKey = state.favorites_only ? profile.favorite_topics.join(",") : "";
  const { state: query, keep } = useMemo(
    () => resolveUserFilters(state, { favorites: favKey ? favKey.split(",") : [], watchlistIds: new Set(watchKey.split(",")) }),
    [state, favKey, watchKey],
  );
  const fetchKey = `${mode}?${key}#${watchKey}#${favKey}`;
  const load = useCallback(
    (s: typeof query, init?: RequestInit) =>
      (mode === "flags" ? fetchFlags : fetchMarkets)(s, init).then((d) => (state.watchlisted_only ? { ...d, groups: undefined, rows: d.rows.filter((r) => keep(r.market.id)) } : d)), // groups dropped: they would point past filtered rows
    [mode, keep, state.watchlisted_only],
  );

  const [res, setRes] = useState<Result>(() => (initial ? { key: fetchKey, data: initial } : { key: "" }));
  const [retry, setRetry] = useState(0);
  const first = useRef(!!initial);
  useEffect(() => {
    if (first.current) {   // the server already sent this page
      first.current = false;
      if (res.key === fetchKey) return;
    }
    const ac = new AbortController();
    load(query, { signal: ac.signal })
      .then((data) => setRes({ key: fetchKey, data }))
      .catch((e) => !ac.signal.aborted && setRes((r) => ({ key: fetchKey, data: r.data, error: String(e?.message ?? e) })));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, retry]);

  const set = useCallback(
    (patch: Partial<FilterState>, opts?: { replace?: boolean }) => {
      const href = pathname + queryFor({ ...state, page: 1, ...patch }, mode);
      softNav(href, { replace: opts?.replace, scroll: !!patch.page });
    },
    [state, pathname, mode],
  );
  const reset = useCallback(() => softNav(pathname), [pathname]);

  /** Append the next page without touching the URL (Best bets "Show more"). */
  const [loadingMore, setLoadingMore] = useState(false);
  // QA-A #71: the last page the server has is the last "Show more"; asking past it got a 400 (the dead last click)
  const lastPage = res.data ? res.data.page + (res.extra ?? 0) : 0;
  const hasMore = !!res.data && lastPage < res.data.pages;
  const loadMore = useCallback(async () => {
    if (!res.data || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await load({ ...query, page: lastPage + 1 });
      // QA-A #46: a page from another scan (a new scan landed, or another server answered) would skip or repeat bets.
      // Start the list again from page 1 of one scan instead of appending.
      if (next.scanned_at !== undefined && res.data.scanned_at !== undefined && next.scanned_at !== res.data.scanned_at) {
        setRetry((n) => n + 1);
        return;
      }
      setRes((r) => {
        if (r.key !== fetchKey) return r;
        const offset = (r.data?.rows.length ?? 0) + (r.more?.length ?? 0);   // next page's group starts shift past the rows already held
        const groups = next.groups?.map((g) => ({ ...g, start: g.start + offset }));
        return { ...r, more: [...(r.more ?? []), ...next.rows], moreGroups: groups ? [...(r.moreGroups ?? []), ...groups] : r.moreGroups, extra: (r.extra ?? 0) + 1 };
      });
    } catch {
      // a failed page leaves the list as it was; the button stays for another try
    } finally {
      setLoadingMore(false);
    }
  }, [res, loadingMore, hasMore, lastPage, load, query, fetchKey]);

  const fresh = res.key === fetchKey;
  return {
    state, set, reset, mode,
    // T-291 #11: only this URL's own answer. While a filter change loads (or after it failed) the list shows its
    // skeleton or error, never the previous filter's rows. The facet counts keep the last answer so the pills don't jump.
    data: fresh && !res.error ? res.data : undefined,
    facets: res.data?.facets,
    more: fresh ? (res.more ?? []) : [],
    moreGroups: fresh ? (res.moreGroups ?? []) : [],
    loading: !fresh,
    error: fresh ? res.error : undefined,
    retry: () => setRetry((n) => n + 1),
    loadMore, loadingMore,
    /** another server page exists after the ones held */
    hasMore: fresh && !res.error && hasMore,
  };
}
