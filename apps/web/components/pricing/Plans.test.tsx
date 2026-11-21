// @vitest-environment jsdom
// T-291 #12, #14, #15: plan buttons are right in the server HTML (no "Coming soon" flash), "Start free" signs up,
// and the yearly "save N%" labels follow the prices in config/site.json.
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { yearlySavingPct, yearlySavings } from "@/lib/billing/plans";
import { can } from "@/lib/entitlements";
import { SITE } from "@/lib/site";
import type { PlanCtx } from "./Plans";

vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const { Plans } = await import("./Plans");

const ctx: PlanCtx = { demo: false, auth: true, billing: true, signedIn: false, tier: "free" };
const html = (c = ctx) => renderToString(<Plans delay={15} ctx={c} />).replaceAll("<!-- -->", "");   // useMe() is null on the server

describe("Plans first paint", () => {
  it("billing configured, signed out: Start trial links to sign-up, never a disabled Coming soon", () => {
    const h = html();
    expect(h).not.toContain("Coming soon");
    expect(h).not.toMatch(/<button[^>]*disabled/);
    // #32: the chosen plan and period ride through sign-up and back to that plan's checkout
    expect(h).toContain(`href="/signup?next=${encodeURIComponent("/pricing?start=pro_monthly")}"`);
    expect(h).toContain(`href="/signup?next=${encodeURIComponent("/pricing?start=premium_monthly")}"`);
  });

  it("billing not configured: Coming soon is the real state", () => {
    expect(html({ ...ctx, billing: false })).toContain("Coming soon");
  });

  it("signed in on Pro: Your plan on Pro and a checkout button on Premium", () => {
    const h = html({ ...ctx, signedIn: true, tier: "pro" });
    expect(h).toContain('href="/account"');
    expect(h).toContain('data-testid="checkout-premium"');
    expect(h).not.toContain("Coming soon");
  });

  it("Start free goes to /signup (signed out, and with accounts off)", () => {
    expect(html()).toMatch(/<a href="\/signup"[^>]*>Start free</);
    expect(html({ ...ctx, auth: false, billing: false })).toMatch(/<a href="\/signup"[^>]*>Start free</);
  });

  it("a signed-in Free user sees Your plan instead of Start free", () => {
    expect(html({ ...ctx, signedIn: true })).not.toContain("Start free");
  });
});

describe("yearly savings follow the prices", () => {
  it("rounds down per plan from monthly × 12", () => {
    expect(yearlySavingPct(11.99, 99.99)).toBe(30);    // 1 - 99.99 / 143.88 = 30.5%
    expect(yearlySavingPct(19.99, 169.99)).toBe(29);   // 1 - 169.99 / 239.88 = 29.1%
    expect(yearlySavingPct(10, 90)).toBe(25);
    expect(yearlySavingPct(10, 120)).toBe(0);
    expect(yearlySavingPct(10, 150)).toBe(0);
    expect(yearlySavingPct(0, 0)).toBe(0);
  });

  it("the labels on the page are computed from config/site.json prices", () => {
    const s = yearlySavings(SITE.prices);
    const h = html();
    expect(h).toContain(`save up to ${s.max}%`);
    // per-plan labels render with the yearly toggle; check the computed values the cards use
    expect(s.pro).toBe(yearlySavingPct(SITE.prices.pro_monthly, SITE.prices.pro_yearly));
    expect(s.premium).toBe(yearlySavingPct(SITE.prices.premium_monthly, SITE.prices.premium_yearly));
  });

  it("the Yearly toggle shows each plan's own saving: Pro 30%, Premium 29% at the owner's prices", () => {
    render(<Plans delay={15} ctx={ctx} />);
    fireEvent.click(screen.getByRole("radio", { name: /Yearly/ }));
    expect(screen.getByTestId("save-pro").textContent).toBe(` · save ${yearlySavings(SITE.prices).pro}%`);
    expect(screen.getByTestId("save-premium").textContent).toBe(` · save ${yearlySavings(SITE.prices).premium}%`);
    if (SITE.prices.pro_monthly === 11.99 && SITE.prices.pro_yearly === 99.99) expect(screen.getByTestId("save-pro").textContent).toContain("save 30%");
  });

  it("changing a price moves the label", () => {
    expect(yearlySavings({ ...SITE.prices, pro_yearly: SITE.prices.pro_monthly * 6 }).pro).toBe(50);
    expect(yearlySavings({ ...SITE.prices, premium_monthly: 20, premium_yearly: 180 }).premium).toBe(25);
  });
});

// QA-D (Nov 21): Combos and Kalshi are live; each plan card lists them where lib/entitlements and lib/beta grant them
// (Combos: Premium; Kalshi markets: every signed-in plan). Neither says "coming soon".
describe("plan cards: Combos and Kalshi follow the entitlements", () => {
  it("Combos on Premium only, Kalshi on every card (Premium via 'Everything in Pro'), neither 'coming soon'", () => {
    const { container } = render(<Plans delay={15} ctx={ctx} />);
    for (const tier of ["free", "pro", "premium"] as const) {
      const card = container.querySelector(`section[aria-labelledby="plan-${tier}"]`)!;
      const items = [...card.querySelectorAll("li")].map((li) => li.textContent ?? "");
      const combos = items.filter((t) => /^Combos/.test(t));
      expect(combos.length, tier).toBe(can(tier, "combos") ? 1 : 0);
      expect(items.some((t) => /^Kalshi markets/.test(t)) || items.includes("Everything in Pro"), tier).toBe(true);
      for (const t of [...combos, ...items.filter((x) => /Kalshi/.test(x))]) expect(t, tier).not.toMatch(/coming soon/i);
    }
  });
});

// #39 (Marc, Nov 20): plan cards and the /pricing compare table list only features that have shipped.
describe("#39 only shipped features are sold", () => {
  it("no plan card item is 'coming soon' or names the unreleased Chrome extension", () => {
    const { container } = render(<Plans delay={15} ctx={ctx} />);
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items.length).toBeGreaterThan(10);
    for (const t of items) expect(t).not.toMatch(/coming soon|chrome extension/i);
  });
  it("the compare table has no 'Coming soon' row", () => {
    const src = readFileSync("app/pricing/page.tsx", "utf8");
    const start = src.indexOf("const rows =");
    const table = src.slice(start, src.indexOf("];", start));
    expect(table).toContain("Saved views");
    expect(table).not.toMatch(/coming soon|chrome extension/i);
  });
});
