// @vitest-environment jsdom
// T-291 #11: after a filter change the hook hands back no rows until this URL's own answer arrives (the list shows
// its skeleton), and a failed fetch never relabels the previous filter's rows as the answer.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketsResponse } from "@/lib/api";

let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({ useSearchParams: () => search, usePathname: () => "/" }));
vi.mock("@/lib/softNav", () => ({ softNav: vi.fn() }));
vi.mock("@/lib/repo/hooks", () => ({ useCollection: () => [], useProfile: () => ({ favorite_topics: [] }) }));
const pending: { resolve: (d: MarketsResponse) => void; reject: (e: Error) => void }[] = [];
vi.mock("@/lib/api", () => ({
  fetchFlags: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  fetchMarkets: vi.fn(), fetchMeta: vi.fn(),
}));
const { useScreener } = await import("./useScreener");

const page = (id: string) => ({ rows: [{ market: { id }, side: { side_index: 0 } }], total: 1, page: 1, page_size: 50, pages: 1, facets: { tag: id } }) as unknown as MarketsResponse;
afterEach(() => { cleanup(); pending.length = 0; search = new URLSearchParams(""); });

describe("useScreener while a filter loads", () => {
  it("returns no rows (loading) until the new answer, then the new rows", async () => {
    const { result, rerender } = renderHook(() => useScreener("flags", page("old")));
    expect(result.current.data?.rows[0]!.market.id).toBe("old");
    search = new URLSearchParams("cat=sports");
    rerender();
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();               // never the old list
    expect(result.current.facets).toEqual({ tag: "old" });     // pills keep their last counts
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]!.resolve(page("new")));
    expect(result.current.data?.rows[0]!.market.id).toBe("new");
  });

  it("a failed fetch shows the error, not the old rows", async () => {
    const { result, rerender } = renderHook(() => useScreener("flags", page("old")));
    search = new URLSearchParams("cat=crypto");
    rerender();
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]!.reject(new Error("boom")));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeUndefined();
  });
});

describe("useScreener Show more (QA-A #71)", () => {
  const pageN = (n: number, pages: number, rows = 1) => ({ ...page(`p${n}`), rows: Array.from({ length: rows }, (_, i) => ({ market: { id: `p${n}-${i}` }, side: { side_index: 0 } })), page: n, pages, page_size: 2, total: 99 }) as unknown as MarketsResponse;

  it("asks for each next page by count, even when live prices left a page short, and stops at the last one", async () => {
    const { result } = renderHook(() => useScreener("flags", pageN(1, 3, 1)));   // page 1 of 3 came back with 1 of 2 rows
    expect(result.current.hasMore).toBe(true);
    let done: Promise<void>;
    act(() => { done = result.current.loadMore(); });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0]!.resolve(pageN(2, 3, 1)); await done; });
    expect(result.current.more.map((r) => r.market.id)).toEqual(["p2-0"]);
    expect(result.current.hasMore).toBe(true);
    act(() => { done = result.current.loadMore(); });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1]!.resolve(pageN(3, 3, 2)); await done; });
    expect(result.current.hasMore).toBe(false);   // no button left to click, so no dead click past the last page
    await act(async () => { await result.current.loadMore(); });
    expect(pending).toHaveLength(2);
  });
});
