// @vitest-environment jsdom
// T-279: a failed save used to be swallowed (the star just stayed "Save"); now it says so and stays retryable.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setRepo } from "@/lib/repo";
import { SupabaseRepo } from "@/lib/repo/supabase";
import { WatchStar } from "./WatchStar";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const repoAnswering = (post: () => Promise<Response>) =>
  new SupabaseRepo("/api/data", async (_url, init) => (init?.method === "POST" ? post() : json(200, {})));
const row = { id: "w1", market_id: "m1", side_index: 1, note: null, target_price: null, snapshot: null, created_at: "2026-11-19T00:00:00Z" };

afterEach(() => { cleanup(); setRepo(repoAnswering(async () => json(500, {}))); });

describe("WatchStar", () => {
  it("shows an error and stays on Save when the write fails", async () => {
    setRepo(repoAnswering(async () => json(500, { error: "boom" })));
    render(<WatchStar marketId="m1" side={1} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save. Try again.");
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
  });

  it("says the list is full on a plan-quota refusal", async () => {
    setRepo(repoAnswering(async () => json(403, { error: "Your plan allows 10", upgrade: true })));
    render(<WatchStar marketId="m1" side={1} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("alert").textContent).toBe("My list is full on your plan.");
  });

  it("is quiet on a unique clash (already saved in another tab)", async () => {
    setRepo(repoAnswering(async () => json(409, { error: "unique_violation" })));
    render(<WatchStar marketId="m1" side={1} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is busy while the write is in flight, then Saved", async () => {
    let answer!: (r: Response) => void;
    setRepo(repoAnswering(() => new Promise((r) => { answer = r; })));
    render(<WatchStar marketId="m1" side={1} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => { answer(json(200, row)); });
    const saved = screen.getByRole("button", { name: "Saved" });
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    expect(saved.getAttribute("aria-busy")).toBeNull();
  });
});
