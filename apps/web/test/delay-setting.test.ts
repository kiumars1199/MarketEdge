// Owner request (Nov 18): every "N minutes behind" the user reads comes from the one setting, free_delay_min.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS, delayMin, setSettingsSnapshot } from "@/lib/settings-core";

describe("Free delay comes from the setting", () => {
  afterEach(() => setSettingsSnapshot(undefined));
  it("delayMin('free') follows free_delay_min", () => {
    setSettingsSnapshot({ ...DEFAULT_SETTINGS, free_delay_min: 25 });
    expect(delayMin("free")).toBe(25);
    expect(delayMin("pro")).toBe(0);
  });
  it("no user-facing copy hard-codes the delay", () => {
    for (const f of ["app/pricing/page.tsx", "components/pricing/Plans.tsx", "lib/auth/server.ts", "components/header/FreshnessPill.tsx", "lib/api.ts", "app/about/page.tsx", "app/status/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\b15 min(ute)?s? behind/i);
    }
  });
});

describe("delay copy (owner, Nov 18)", () => {
  it("0 → live, 1 → at least 1 minute, N → at least N minutes", async () => {
    const { behindWords, delayWords } = await import("@/lib/format");
    expect(delayWords(0)).toBe("live");
    expect(delayWords(1)).toBe("at least 1 minute");
    expect(delayWords(15)).toBe("at least 15 minutes");
    expect(behindWords(0)).toBe("live");
    expect(behindWords(1)).toBe("at least 1 minute behind");
    expect(behindWords(30)).toBe("at least 30 minutes behind");
  });
  it("no copy builds the delay as `${n} minutes` by hand", () => {
    for (const f of ["app/pricing/page.tsx", "components/pricing/Plans.tsx", "lib/auth/server.ts", "components/header/FreshnessPill.tsx", "lib/api.ts", "app/status/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\{(delay|min)\}\s*minutes/);
    }
  });
});
