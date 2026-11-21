// docs/16 §3 + docs/15: no auto-trading code paths. Every order traces to a user click on Kismet's confirm screen,
// which reaches the extension as one "place" intent with a server nonce. This test fails if anything else calls placeOrder.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
const src = files(SRC).filter((f) => f.endsWith(".ts")).map((f) => ({ f: f.slice(SRC.length + 1), text: readFileSync(f, "utf8") }));

describe("no auto-trading", () => {
  it("placeOrder is called exactly once, inside the external 'place' intent handler", () => {
    const calls = src.flatMap(({ f, text }) => [...text.matchAll(/\bplaceOrder\s*\(/g)].map((m) => ({ f, at: m.index! })));
    expect(calls).toHaveLength(1);
    const { f, at } = calls[0]!;
    expect(f).toBe("background.ts");
    const text = src.find((s) => s.f === f)!.text;
    const handler = text.lastIndexOf("place: async", at);
    expect(handler).toBeGreaterThan(text.indexOf("const external"));
    // nothing between the handler start and the call except this one handler body
    expect(text.slice(handler, at)).not.toMatch(/\n  [a-z]+: async/);
    expect(text.slice(handler, at)).toMatch(/checkNonce\(m\.nonce, "place"/);
  });

  it("no timers, alarms or batch order endpoints anywhere in the extension", () => {
    for (const { f, text } of src) {
      if (f === "content.ts") continue; // UI throttle/pill timers; content scripts can't reach trading (no handler accepts them)
      expect(text, f).not.toMatch(/setInterval|chrome\.alarms|batch|orders\/batched/i);
      if (/placeOrder|cancelOrder/.test(text)) expect(text, f).not.toMatch(/setTimeout/);
    }
  });
});
