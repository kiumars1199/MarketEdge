// Combos on the server (lib/beta.ts, lib/entitlements), not just the UI: live since Nov 21 (owner decision) for Premium.
// /api/combos answers Premium with combos and everyone else with none; /combos shows Free and Pro the upgrade link.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/entitlements";
import type { CombosResponse } from "@/lib/data/combos";

const h = vi.hoisted(() => ({ tier: "premium" as Tier, beta: false }));
vi.mock("@/lib/auth/server", () => ({
  getMe: async () => ({ user: { id: "u1", email: "u@x.test" }, tier: h.tier, beta: h.beta, status: null, current_period_end: null, cancel_at_period_end: false }),
  getTier: async () => h.tier,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: false }) }));

const { GET } = await import("@/app/api/combos/route");
const { default: Page } = await import("@/app/combos/page");
const combos = async (q = "") => (await (await GET(new Request(`http://t/api/combos${q}`))).json()) as CombosResponse;

afterEach(() => { h.tier = "premium"; h.beta = false; });

describe("combos are live for Premium", () => {
  it("a Premium customer gets them from the row and the browse page, with exact numbers, and no Beta banner", async () => {
    const g = (await combos("?pays=2")).groups;
    expect(g.length).toBeGreaterThan(0);
    expect(g[0]!.combos[0]!.ret_range).toBeUndefined();
    const html = JSON.stringify(await Page());
    expect(html).not.toContain("beta-banner");
    expect(html).not.toContain("combos-upgrade");
  });
  it("Free and Pro (even a tester) get none, and /combos shows the upgrade link instead of a 404", async () => {
    for (const t of ["free", "pro"] as Tier[]) {
      h.tier = t; h.beta = true;
      expect((await combos()).groups, t).toEqual([]);
      expect((await combos("?pays=2")).groups, t).toEqual([]);
      expect(renderToStaticMarkup(await Page()), t).toContain('data-testid="combos-upgrade"');
    }
  });
});
