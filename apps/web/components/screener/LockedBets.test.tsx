// @vitest-environment jsdom
// docs/19 P3, T-302: Free sees the day's sample, then one solid card with a lock and "Unlock N more bets" to /pricing.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("@/lib/telemetry", () => ({ track }));
const { LockedBets } = await import("./LockedBets");
afterEach(cleanup);

describe("LockedBets", () => {
  it("one link to pricing naming the locked count, with no market rows and no fake cards", () => {
    const { container } = render(<LockedBets total={2778} shown={10} daily={10} desktop />);
    const link = screen.getByRole("link", { name: "Unlock 2,768 more bets" });
    expect(link.getAttribute("href")).toBe("/pricing");
    expect(container.querySelectorAll("[data-row], [data-market-id], ul, [inert]")).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/blur|gradient/);
    fireEvent.click(link);
    expect(track).toHaveBeenCalledWith("upgrade_clicked", { source: "locked_bets" });
  });

  it("renders nothing when every bet is already shown", () => {
    const { container } = render(<LockedBets total={10} shown={10} daily={10} />);
    expect(container.innerHTML).toBe("");
  });

  it("one locked bet reads in the singular", () => {
    render(<LockedBets total={11} shown={10} daily={10} />);
    expect(screen.getByRole("link").textContent).toBe("Unlock 1 more bet");
  });

  it("T-288: states the daily allowance, never the number of rows on the page", () => {
    const { container } = render(<LockedBets total={1070} shown={4} daily={10} desktop />);
    expect(container.textContent).toContain("Free shows 10 Best bets a day, chosen at random");
    expect(screen.getByRole("link").textContent).toBe("Unlock 1,066 more bets");
    expect(container.textContent).not.toMatch(/Free shows 4\b/);
  });

  it("says when the free bets don't match the filters", () => {
    const { container } = render(<LockedBets total={30} shown={0} daily={10} />);
    expect(container.textContent).toContain("Your free bets for today don't match these filters.");
  });
});
