// "Mine" filters (docs/04 § 9). The API has no user context, so favorites_only / watchlisted_only return 0 rows
// server-side. Resolve them in the browser before fetching: fav=1 → topics=<favorite ids>; wl=1 → client keep().
import type { FilterState } from "./state";

export interface UserFilterCtx { favorites: string[]; watchlistIds: Set<string> }

export function resolveUserFilters(state: FilterState, ctx: UserFilterCtx): { state: FilterState; keep: (marketId: string) => boolean } {
  const out = { ...state, favorites_only: undefined, watchlisted_only: undefined };
  // ponytail: an explicit topic filter wins over favorites (no AND of two OR-lists); fine while chips drive both
  if (state.favorites_only && ctx.favorites.length && !state.topics?.length) out.topics = ctx.favorites;
  // ponytail: wl=1 filters each fetched page, so pages can come back short; an ids= API param fixes it if needed
  const keep = state.watchlisted_only ? (id: string) => ctx.watchlistIds.has(id) : () => true;
  return { state: out, keep };
}
