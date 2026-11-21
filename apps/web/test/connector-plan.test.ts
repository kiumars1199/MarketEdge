// #38/#58/#72 (Marc, Nov 20): one statement of the AI connector allowance, equal to what the rate limiter enforces,
// and no surface that words it on its own.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpSetup } from "@/components/account/McpSetup";
import { RULES } from "@/lib/abuse";
import { CONNECTOR_PLANS_LINE, CONNECTOR_PREMIUM_PER_MINUTE, CONNECTOR_PRO_PER_DAY, connectorAllowance } from "@/lib/connector-plan";

const ROOT = join(import.meta.dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe("AI connector allowance (#38/#58/#72)", () => {
  it("is what the rate limiter enforces", () => {
    expect(RULES.mcp_pro_daily).toEqual({ limit: CONNECTOR_PRO_PER_DAY, window: "1 d" });
    expect(RULES.mcp_premium).toEqual({ limit: CONNECTOR_PREMIUM_PER_MINUTE, window: "1 m" });
    expect(connectorAllowance("pro")).toBe("3 calls a day");
    expect(connectorAllowance("premium")).toBe("no daily cap (up to 60 calls a minute)");
    expect(CONNECTOR_PLANS_LINE).toBe("Pro: 3 calls a day. Premium: no daily cap (up to 60 calls a minute). Not on Free.");
  });

  it("/account says the same for each plan", () => {
    const at = (tier: "free" | "pro" | "premium") => renderToStaticMarkup(createElement(McpSetup, { tier, url: "https://x.test/api/mcp" }));
    expect(at("premium")).toContain("Your Premium plan: no daily cap (up to 60 calls a minute).");
    expect(at("pro")).toContain("Your Pro plan: 3 calls a day.");
    expect(at("pro")).toContain("Premium: no daily cap (up to 60 calls a minute).");
    expect(at("free")).toContain("Not on Free. Pro: 3 calls a day. Premium: no daily cap (up to 60 calls a minute).");
  });

  it("no page words the allowance by hand (compare table, plan cards, /account, consent, llms.txt use lib/connector-plan.ts)", () => {
    const hand = /\b\d+ calls a (day|minute)\b|calls a day|calls a minute|no daily cap/i;
    const offenders = ["app", "components", "lib"].flatMap((d) => files(join(ROOT, d)))
      .filter((f) => !f.endsWith("connector-plan.ts") && !f.endsWith(join("mcp", "server.ts")))
      .filter((f) => hand.test(readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")));
    expect(offenders).toEqual([]);
  });
});
