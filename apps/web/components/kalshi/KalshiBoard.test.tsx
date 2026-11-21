// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCLAIMER, Footer } from "@/components/shell/Footer";
import type { KalshiFile } from "@/lib/types";
import { KalshiBoard } from "./KalshiBoard";

const data = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../test/fixtures/kalshi.json"), "utf8")) as KalshiFile;

describe("KalshiBoard", () => {
  afterEach(cleanup);

  it("credits Kalshi on every number and opens kalshi.com in a new tab", () => {
    const { container } = render(<KalshiBoard data={data} />);
    // markets: 4 numbers per row; combos: one per leg + the combo price
    const nums = container.querySelectorAll("[data-kalshi-credit]");
    expect(nums.length).toBe(data.markets.length * 4 + data.combos.reduce((n, c) => n + c.legs.length + 1, 0));
    for (const n of nums) {
      expect(n.getAttribute("title")).toMatch(/: Kalshi$/);
      expect(n.textContent).toMatch(/Kalshi$/);
    }
    const links = container.querySelectorAll("a");
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^https:\/\/kalshi\.com(\/|$)/);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("labels each combo price by its basis", () => {
    render(<KalshiBoard data={data} />);
    const combos = within(screen.getByRole("region", { name: "Kalshi Combos" }));
    expect(combos.getByText("Legs' Kalshi asks multiplied")).toBeTruthy();
    expect(combos.getByText("Kalshi's combo ask")).toBeTruthy();
    expect(combos.getByText("18.9%")).toBeTruthy();
    expect(combos.getByText(/same event/)).toBeTruthy();
  });
});

describe("footer link to /kalshi", () => {
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("shown once KALSHI_DATA_PERMISSION=true (Kalshi is live, Nov 21), hidden without it; disclaimer unchanged", () => {
    const off = render(<Footer />);
    expect(off.container.querySelector('a[href="/kalshi"]')).toBeNull();
    expect(off.container.textContent).toContain(DISCLAIMER);
    cleanup();
    vi.stubEnv("KALSHI_DATA_PERMISSION", "true");
    expect(render(<Footer />).container.querySelector('a[href="/kalshi"]')).not.toBeNull();
  });
});
