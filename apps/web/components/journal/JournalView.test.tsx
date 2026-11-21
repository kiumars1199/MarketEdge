// @vitest-environment jsdom
// AUDIT run 3 fail 3: the "Bets" tile printed raw counts (String(s.bets)); docs/18 §4 wants formatCount ("1.2K").
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JournalEntry } from "@/lib/repo/types";

const bet = (i: number, o: Partial<JournalEntry> = {}): JournalEntry => ({
  id: `j${i}`, market_id: `m${i}`, side_index: 0, outcome: "Yes", question: "Q?", category: "sports", niche: "nfl",
  price: 0.6, shares: 10, fee: 0.012, placed_at: "2026-11-16T03:30:00.000Z",
  model_win_prob: 0.7, model_edge: 0.088, closing_price: 0.65, result: "won", settled_at: "2026-11-17T00:00:00.000Z",
  pnl_usd: 3.88, tags: [], note: null, ...o,
});
const rows = [...Array.from({ length: 200 }, (_, i) => bet(i)), ...Array.from({ length: 1000 }, (_, i) => bet(5000 + i, { result: null, settled_at: null, pnl_usd: null }))];

vi.mock("@/lib/repo/hooks", () => ({ useCollection: () => rows, useProfile: () => ({ numbers_mode: "simple", odds_format: "cents" }) }));
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));   // settlement check never answers
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const { JournalView } = await import("./JournalView");

describe("JournalView counts", () => {
  it("formats the bet and open counts with formatCount", () => {
    render(<JournalView />);
    expect(screen.getByText("1,200 · 1,000 open")).toBeTruthy();   // QA-A #6: exact below 10,000
    expect(document.body.textContent).not.toContain("1200");
  }, 30_000);   // 1,200 table rows in jsdom; slow when the whole suite runs in parallel
});
