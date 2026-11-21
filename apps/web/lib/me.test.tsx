// @vitest-environment jsdom
// QA-A #13/#40: a failed /api/me is retried with back-off, so a paid account doesn't stay "plan unknown" (or worse, read
// as Free) for the rest of the visit; and nothing paid-only is upsold until the plan is known.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ME_RETRY_MS, _resetMe, currentMe, loadMe } from "./me";

vi.mock("@/lib/repo/hooks", () => ({ useProfile: () => ({ favorite_topics: [] }), useCollection: () => [] }));

const pro = { user: { id: "u", email: "a@b.c" }, tier: "pro", status: "active", current_period_end: null, cancel_at_period_end: false, demo: false, auth: true, billing: true };

afterEach(() => { cleanup(); _resetMe(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("loadMe", () => {
  it("retries a failed /api/me with back-off until it answers", async () => {
    vi.useFakeTimers();
    const answers = [new Response("", { status: 503 }), new Response("", { status: 500 }), Response.json(pro)];
    const fetch = vi.fn(async () => answers.shift()!);
    vi.stubGlobal("fetch", fetch);
    expect(await loadMe()).toBeNull();
    expect(currentMe()).toBeNull();
    await vi.advanceTimersByTimeAsync(ME_RETRY_MS[0]!);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ME_RETRY_MS[1]!);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(currentMe()?.tier).toBe("pro");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);   // no more requests once it answered
  });

  it("gives up after the last back-off step", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await loadMe();
    await vi.advanceTimersByTimeAsync(ME_RETRY_MS.reduce((a, b) => a + b, 0) + 1_000);
    expect(fetch).toHaveBeenCalledTimes(1 + ME_RETRY_MS.length);
  });
});

describe("paid-only upsells wait for the plan", () => {
  it("Export CSV shows no '· Pro' upsell before /api/me answers, then the real button for Pro", async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { answer = r; })));
    const { ExportCsv } = await import("@/components/presets/ExportCsv");
    render(<ExportCsv state={{} as never} />);
    void loadMe();
    expect(screen.queryByText(/Export CSV · Pro/)).toBeNull();
    await act(async () => { answer(Response.json(pro)); await Promise.resolve(); });
    expect(await screen.findByRole("button", { name: /Export CSV/ })).toBeTruthy();
    expect(screen.queryByText(/· Pro/)).toBeNull();
  });
});
