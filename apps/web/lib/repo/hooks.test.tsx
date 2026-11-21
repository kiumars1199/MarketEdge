// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useCollection, useProfile } from "./hooks";
import { getRepo } from "./index";

it("hooks re-render on repo writes", async () => {
  const rows = renderHook(() => useCollection("watchlist"));
  const prof = renderHook(() => useProfile());
  expect(rows.result.current).toEqual([]);
  await act(() => getRepo().watchlist.insert({ market_id: "m", side_index: 1, note: null, target_price: 0.6, snapshot: null }));
  expect(rows.result.current).toHaveLength(1);
  await act(() => getRepo().profile.patch({ theme: "light" }));
  expect(prof.result.current.theme).toBe("light");
});
