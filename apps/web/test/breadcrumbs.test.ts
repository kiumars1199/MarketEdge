// docs/19 P7: market and event pages carry breadcrumbs; the topic crumb links to All markets filtered to that topic,
// using the same URL keys the filter bar reads back (t = topic, c = category).
import { describe, expect, it } from "vitest";
import { topicCrumb, topicLabel } from "@/components/market/labels";
import { parse } from "@/lib/filters/url";
import type { Market } from "@/lib/types";

const soccer = { category: "sports", niche: "soccer", tags: ["sports", "games", "soccer", "uefa-nations-league"], market_type: "props" } as unknown as Market;
const weather = { category: "weather", niche: "weather", tags: ["weather", "daily-temperature"], market_type: "multi-outcome" } as unknown as Market;

describe("topicCrumb", () => {
  it("names the topic as the cards do and links to a filter the screener understands", () => {
    for (const m of [soccer, weather]) {
      const c = topicCrumb(m);
      expect(c.label).toBe(topicLabel(m));
      const q = new URLSearchParams(c.href.split("?")[1]);
      const st = parse(q);
      expect(c.href.startsWith("/markets?")).toBe(true);
      expect([...(st.topics ?? []), ...(st.categories ?? [])].length).toBe(1);
    }
  });
  it("uses the category key for a non-sports market", () => {
    expect(topicCrumb(weather).href).toBe("/markets?c=weather");
  });
});
