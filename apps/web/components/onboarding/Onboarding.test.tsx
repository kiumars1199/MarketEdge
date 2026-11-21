// @vitest-environment jsdom
// AUDIT run 3 fail 2: repeated "Skip setup" clicks each started a save and a navigation. Skip is enabled once
// hydrated and runs once.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
const patch = vi.fn(async () => ({ favorite_topics: [] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/repo", () => ({ DEMO_MODE: true, repoReady: Promise.resolve(), getRepo: () => ({ profile: { patch } }) }));
vi.mock("@/lib/repo/hooks", () => ({ useProfile: () => ({ favorite_topics: [], default_stake_usd: 25 }) }));
vi.mock("@/components/settings/TopicsPicker", () => ({ TopicsPicker: () => null }));

const { Onboarding } = await import("./Onboarding");

describe("Onboarding Skip setup", () => {
  it("is enabled after mount and saves and navigates once however often it is clicked", async () => {
    render(<Onboarding next="/account" />);
    const skip = screen.getByRole("button", { name: "Skip setup" }) as HTMLButtonElement;
    expect(skip.disabled).toBe(false);
    await act(async () => { fireEvent.click(skip); fireEvent.click(skip); fireEvent.click(skip); });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/account");
    expect(skip.disabled).toBe(true);
  });
});
