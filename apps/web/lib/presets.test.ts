// @vitest-environment jsdom
import { expect, it } from "vitest";
import { getStore } from "@/lib/data/store";
import { apply } from "@/lib/filters/apply";
import { defaultState } from "@/lib/filters/state";
import { parse } from "@/lib/filters/url";
import { getRepo } from "@/lib/repo";
import { TAXONOMY } from "@/lib/taxonomy";
import { BUILTIN_PRESETS, SHARE_KEY, presetState, sameView, savePresetFromState, shareLink } from "./presets";

const get = (id: string) => presetState(BUILTIN_PRESETS.find((p) => p.id === id)!.patch);

it("built-ins use real taxonomy ids and parse", () => {
  for (const p of BUILTIN_PRESETS) for (const t of p.patch.topics ?? []) expect(TAXONOMY[t]).toBeDefined();
  expect(get("builtin:best-bets").verdicts).not.toContain("not worth it");
});

it("best bets and longshots return rows on fixtures", async () => {
  const store = await getStore();
  expect(apply(store, get("builtin:best-bets")).total).toBeGreaterThan(0);
  const longshots = apply(store, get("builtin:longshots"));
  expect(longshots.total).toBeGreaterThan(0);
  expect(longshots.rows.every((r) => r.side.ask <= 0.25)).toBe(true);
});

it("savePresetFromState stores the view and a share link reproduces it", async () => {
  const state = { ...defaultState(), topics: ["sports.nfl"], edge_min: 0.02, page: 3 };
  const p = await savePresetFromState(state, " NFL edges ");
  expect(p.name).toBe("NFL edges");
  expect(sameView(presetState(p.query), state)).toBe(true);
  expect((await getRepo().presets.list()).length).toBe(1);
  const url = new URL(shareLink(state, p.name, "http://x/markets"));
  expect(url.searchParams.get(SHARE_KEY)).toBe("NFL edges");
  expect(sameView(parse(url.searchParams), state)).toBe(true);
});
