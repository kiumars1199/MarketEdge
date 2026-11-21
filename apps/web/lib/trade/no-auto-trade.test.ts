// docs/16 §3 + docs/15: no auto-trading code paths. Every order traces to a click on the ticket's confirm screen.
// Fails if anything other than onConfirm places an order, or if order intents are sent from anywhere else.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name.startsWith(".") || e.name === "e2e" ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const src = ["app", "components", "lib"].flatMap((d) => walk(join(ROOT, d)))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ f: relative(ROOT, f), text: readFileSync(f, "utf8") }));

describe("no auto-trading (web)", () => {
  it("placeOrder() is called exactly once, from the confirm button's handler", () => {
    const calls = src.flatMap(({ f, text }) => [...text.matchAll(/\bplaceOrder\(/g)].map((m) => ({ f, at: m.index!, text })));
    const uses = calls.filter((c) => !/async function placeOrder\($/.test(c.text.slice(c.at - 21, c.at + 11)));
    expect(uses).toHaveLength(1);
    const { f, at, text } = uses[0]!;
    expect(f).toBe("components/trade/TradeTicket.tsx");
    const handler = text.lastIndexOf("const onConfirm = async", at);
    expect(handler).toBeGreaterThan(-1);
    expect(text.slice(handler, at)).not.toMatch(/\n  (const|function) /); // still inside onConfirm
    expect(text).toMatch(/onClick=\{onConfirm\}/);
    expect(text.match(/onConfirm/g)).toHaveLength(2); // defined once, wired once (to the button)
  });

  it("order intents ('place') are only sent by placeOrder, never in a timer or loop", () => {
    const sends = src.filter(({ text }) => /type:\s*"place"/.test(text));
    expect(sends.map((s) => s.f)).toEqual(["components/trade/TradeTicket.tsx"]);
    const text = sends[0]!.text;
    const fn = text.slice(text.indexOf("async function placeOrder("), text.indexOf("function Confirm("));
    expect(fn).toMatch(/type: "place"/);
    expect(fn).not.toMatch(/setInterval|setTimeout|for \(|while \(|\.map\(|\.forEach\(/);
    expect(text.slice(text.indexOf("const onConfirm"), text.indexOf("return (", text.indexOf("const onConfirm")))).not.toMatch(/setInterval|setTimeout|for \(|while \(/);
  });

  it("no batch order or 'trade all' code paths", () => {
    for (const { f, text } of src) expect(text, f).not.toMatch(/orders\/batched|trade all|tradeAll|batchOrder/i);
  });
});
