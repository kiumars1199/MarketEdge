// Audit fail 8 (docs/01 Compliance): no claim of guaranteed or expected profit anywhere a user can read it,
// including meta, OG images and emails. Numbers are "estimated" and "based on past results".
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getStore } from "@/lib/data/store";
import { unsubscribeUrl } from "@/lib/email";
import { alertEmail, paymentFailedEmail, signInEmail } from "@/lib/email/templates";
import { PROFIT_CLAIM } from "./profit-claim";

const root = path.resolve(import.meta.dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|html)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
/** Source minus comments: what can reach a page, a meta tag, an image or an email. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

describe("no expected-profit or guarantee wording (audit fail 8)", () => {
  it("in any web or extension source a user can see", () => {
    const files = [
      ...["app", "components", "lib"].flatMap((d) => walk(path.join(root, d))),
      ...walk(path.join(root, "../extension/src")),
      ...["popup.html", "sidepanel.html"].map((f) => path.join(root, "../extension", f)),
    ];
    const hits = files.flatMap((f) =>
      strip(readFileSync(f, "utf8")).split("\n").flatMap((l, i) => (PROFIT_CLAIM.test(l) ? [`${path.relative(root, f)}:${i + 1}: ${l.trim()}`] : [])));
    expect(hits).toEqual([]);
  });

  it("catches the audit run 2 forms: bare label, figure + expected, Expected-return", () => {
    for (const bad of [`: "expected"}`, `/>Expected at entry`, `"Actual" : "Expected"]`, `"+20–50% expected"`, "${ret(b.roi_pct)} expected`",
      `description: "Expected-return and bet-sizing calculators"`])
      expect(bad).toMatch(PROFIT_CLAIM);
    for (const ok of [`dataKey="expected"`, `expectedReturn(p, q)`, `r.expected_profit_usd`, `"+14% estimated"`, "Estimated at entry"])
      expect(ok).not.toMatch(PROFIT_CLAIM);
  });

  it("in every page's meta description", () => {
    const pages = walk(path.join(root, "app")).filter((f) => /(page|layout)\.tsx$/.test(f));
    const metas = pages.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/description:\s*(["'`])((?:(?!\1).)*)\1/g)].map((m) => [f, m[2]!] as const));
    expect(metas.length).toBeGreaterThan(5);
    expect(metas.filter(([, d]) => /expect/i.test(d))).toEqual([]);
  });

  it("in the /m/[id] OG image and meta description", () => {
    for (const f of ["app/m/[id]/opengraph-image.tsx", "app/m/[id]/page.tsx", "app/opengraph-image.tsx"]) {
      let src = "";
      try { src = readFileSync(path.join(root, f), "utf8"); } catch { continue; }   // site OG image lands in T-158
      expect(src, f).not.toMatch(PROFIT_CLAIM);
    }
  });

  it("in the alert, sign-in and payment-failed emails", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "s");
    const store = await getStore();
    const unsub = unsubscribeUrl("u1");
    const emails = [
      ...store.flags.slice(0, 20).map((m) => alertEmail({ to: "a@b.test", ruleName: "r", market: m, side: m.best, timeZone: "UTC", unsubscribeUrl: unsub })),
      signInEmail("a@b.test", "https://x.test/link", unsub),
      paymentFailedEmail("a@b.test", unsub),
    ];
    for (const e of emails) for (const part of [e.subject, e.html, e.text]) expect(part).not.toMatch(PROFIT_CLAIM);
    vi.unstubAllEnvs();
  });
});
