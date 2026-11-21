// T-276: what a signed-out visitor's HTML carries. /m/* and /event/* are teasers (title, category, closing time,
// sign-up), with no verdict or model number in the page or its metadata. The landing (T-301) shows 1 + 3 real bets
// through the Free gate and no performance numbers.
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiRow } from "@/lib/api";

vi.mock("@/lib/auth/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/server")>()),
  authEnabled: () => true,
  getUser: async () => null,
  getMe: async () => ({ user: null, tier: "free", status: null, current_period_end: null, cancel_at_period_end: false, beta: false }),
}));
const reads = vi.hoisted(() => ({ n: 0 }));   // calls to headers()/cookies(): the landing must make none (static, lane C)
vi.mock("next/headers", () => ({
  headers: async () => (reads.n++, new Headers()),
  cookies: async () => (reads.n++, { get: () => undefined, getAll: () => [] }),
}));
// Client components: the landing test only needs which rows reach them.
vi.mock("@/components/market/BetCard", () => ({
  BetCard: ({ r }: { r: ApiRow }) => createElement("article", { "data-row": "", "data-market-id": r.market.id }, r.market.question),
}));
vi.mock("@/components/pricing/Plans", async (orig) => ({
  ...(await orig<typeof import("@/components/pricing/Plans")>()),   // the real Faq (T-290 reads the FAQ text)
  Plans: () => createElement("div", { "data-plans": "" }),
}));

const { getStore, getStoreFor } = await import("@/lib/data/store");
const { TEASER_DESCRIPTION, TEASER_LINE } = await import("@/lib/teaser");
const { price, pct } = await import("@/lib/format");
const market = await import("@/app/m/[id]/page");
const event = await import("@/app/event/[id]/page");
const { HEADLINE, Landing, LANDING_HERO, LANDING_MORE, LANDING_SAMPLE, landingBets } = await import("@/components/landing/Landing");
const { bannedHits } = await import("@/lib/banned");
const { freeSample } = await import("@/lib/data/respond");
const { DELAY_MIN } = await import("@/lib/entitlements");

const html = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as ReactElement);
/** Words and keys that only come from the model or the scan's prices. */
const MODEL = [/Pays \d/, /wins about/i, /\bedge\b/i, /est(imated)? return/i, /Best bet\b/, /Good price/, /win chance/i, /side_index/, /win_prob/, /"ask"/, /ranges/];

describe("signed-out market and event pages are teasers", async () => {
  const store = await getStore();
  const flagged = [...store.flagsById.values()].slice(0, 5);

  it("/m/[id]: title, category, closing time and sign-up with next; no verdict or numbers in the page or metadata", async () => {
    for (const m of flagged) {
      const props = { params: Promise.resolve({ id: m.id }), searchParams: Promise.resolve({}) };
      const out = await html(market.default(props));
      expect(out).toContain('data-testid="teaser"');
      expect(out).toContain(TEASER_LINE);
      expect(out).toContain(`/signup?next=${encodeURIComponent(`/m/${m.id}`)}`);
      for (const re of MODEL) expect(out, `${m.id}: ${re}`).not.toMatch(re);
      for (const s of m.sides ?? []) {
        if (typeof s.ask === "number") expect(out).not.toContain(price(s.ask));
        if (typeof s.win_prob === "number") expect(out).not.toContain(pct(s.win_prob));
      }
      const meta = await market.generateMetadata(props);
      expect(meta.description).toBe(TEASER_DESCRIPTION);
      expect(JSON.stringify(meta)).not.toMatch(/\d+¢|\d+%/);
    }
  });

  it("/event/[id]: same teaser, no numbers", async () => {
    const ids = [...new Set(flagged.map((m) => m.event_id))].filter(Boolean).slice(0, 3) as string[];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const props = { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) };
      const out = await html(event.default(props as never));
      expect(out).toContain(TEASER_LINE);
      for (const re of MODEL) expect(out, `${id}: ${re}`).not.toMatch(re);
      expect(JSON.stringify(await event.generateMetadata(props as never))).not.toMatch(/\d+¢|\d+%/);
    }
  });
});

describe("signed-out landing (T-301)", () => {
  // QA-A: the Free daily sample is seeded by the UTC day (lib/data/respond.ts freeSample), so pin "now" to just after
  // the fixture scan. Unpinned, the sample (and whether it held 4 games) changed with the calendar date. "Just after" =
  // Free's delay plus 5 min, so the fixture scan is old enough for Free's delayed copy.
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(((await getStore()).meta.scanned_at + (DELAY_MIN.free + 5) * 60) * 1000);
  });
  afterAll(() => { vi.useRealTimers(); });

  it(`shows ${LANDING_HERO} + ${LANDING_MORE} real bets from the Free daily sample, one per game, clean titles`, async () => {
    const out = await html(Landing());
    const real = [...out.matchAll(/data-market-id="([^"]+)"/g)].map((x) => x[1]!);
    expect(real.length).toBeGreaterThan(0);
    expect(real.length).toBeLessThanOrEqual(LANDING_HERO + LANDING_MORE);
    const free = await getStoreFor("free");
    const sample = freeSample(free, LANDING_SAMPLE);   // the Free daily sample, like a Free account's /api/flags
    for (const id of real) expect(sample.has(id), id).toBe(true);
    const byId = (await getStore()).byId;
    const games = real.map((id) => byId.get(id)?.event_id || id);
    expect(new Set(games).size, "one bet per game").toBe(games.length);
    for (const id of real) expect(bannedHits(byId.get(id)!.question, { counts: true }), id).toEqual([]);
    expect(out).not.toContain('data-testid="placeholder"');   // no blurred stand-ins (§B: they look like a glitch)
    expect(out).not.toContain('href="/bets"');   // every CTA leads to sign-up, not to a page that redirects
  });

  it("landingBets: Polymarket US first, then list order; skips banned titles and repeat games", () => {
    const row = (id: string, ev: string, q: string, us = false) =>
      ({ market: { id, event_id: ev, question: q, us: us ? { url: `https://polymarket.us/event/${id}` } : null }, side: { side_index: 0 } }) as unknown as ApiRow;
    const rows = [row("a", "e1", "Will Arsenal win?"), row("b", "e2", "Spread: Brazil (-3.5)", true), row("c", "e3", "Will Leeds win?", true),
      row("d", "e3", "Will Leeds draw?", true), row("e", "e4", "Will Spurs win?"), row("f", "e5", "Will BTC hit 120,000?"), row("g", "e6", "Will Celtic win?")];
    expect(landingBets(rows).map((r) => r.market.id)).toEqual(["c", "a", "e", "g"]);
    expect(landingBets(rows, 2).map((r) => r.market.id)).toEqual(["c", "a"]);
    expect(landingBets(rows, 6).map((r) => r.market.id)).toEqual(["c", "a", "e", "g", "d"]);   // short of games: a 2nd line fills in
  });

  it("order: hero, 3 steps, bets, plans, FAQ (5 questions), results link; no proof, counts or banned words", async () => {
    const out = await html(Landing());
    const at = (s: string) => { const i = out.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const order = [at('id="hero-h"'), at('data-testid="landing-cta"'), at('data-testid="landing-hero-bet"'), at('id="steps-h"'), at('id="bets-h"'),
      at('id="price-h"'), at('id="faq-h"'), at('href="/track-record"')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain(HEADLINE);
    expect(out.match(/<details/g)).toHaveLength(5);
    expect(out.match(/<li class="flex flex-col gap-3 rounded-card/g)).toHaveLength(3);   // the 3 steps
    expect(out.match(/<a [^>]*>Sign up free<\/a>/g)).toHaveLength(1);   // one primary button (R1-3)
    for (const gone of ['data-testid="proof-line"', "Market says", "Won before", "Bars use", "data-best-bets", "Less luck"]) expect(out).not.toContain(gone);
    const text = out.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
    expect(bannedHits(text, { counts: true })).toEqual([]);   // BetCard and Plans are mocked: the landing's own words
  });

  it("reads no cookies or headers (static rendering, lane C)", async () => {
    reads.n = 0;
    await html(Landing());
    expect(reads.n).toBe(0);
  });
});

describe("signed-out teaser while the store isn't there yet", () => {
  it("renders the pending state, not a 404", async () => {
    vi.resetModules();
    vi.doMock("@/lib/data/store", async (orig) => {
      const real = await orig<typeof import("@/lib/data/store")>();
      return { ...real, getStoreFor: async () => { throw new real.DelayedPending(); } };   // Free's delayed copy not published yet
    });
    const page = await import("@/app/m/[id]/page");
    const ev = await import("@/app/event/[id]/page");
    const props = { params: Promise.resolve({ id: "6674492" }), searchParams: Promise.resolve({}) };
    for (const out of [await html(page.default(props)), await html(ev.default(props as never))]) {
      expect(out).not.toContain('data-testid="teaser"');
      expect(out).toMatch(/role="status"|pending|being prepared|Couldn/i);
    }
    vi.doUnmock("@/lib/data/store");
  });
});

// T-290: on every page that shows the test return, the live record is printed beside it (lib/proof siteProof), and
// the FAQ splits hit rate from profit with the one shared sentence.
describe("the test return never stands alone (T-290)", async () => {
  const { HIT_RATE_VS_PROFIT, siteProof } = await import("@/lib/proof");
  const store = await getStore();
  const p = siteProof({ backtest: store.backtest, ledger: store.ledgerSummary, since: store.ledgerSince });
  const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  // The landing shows no test or live numbers at all since T-301 (docs/OVERHAUL.md §E), so it isn't in this list.
  const pages: [string, () => Promise<unknown>][] = [
    ["/about", async () => (await import("@/app/about/page")).default()],
    ["/track-record", async () => (await import("@/app/track-record/page")).default()],
    ["/pricing", async () => (await import("@/app/pricing/page")).default()],
  ];
  for (const [name, el] of pages) {
    it(`${name}: test line and live line together, with the basis on hover`, async () => {
      const out = await html(el());
      const want = p;
      expect(want.test).toBeTruthy();
      expect(text(out), name).toContain(want.line);
      expect(out).toContain('data-testid="proof-line"');
      expect(out).toMatch(/data-testid="proof-line"[^>]*title="Testing: /);
    });
  }
  it("/about and /pricing FAQs use the hit-rate vs profit sentence verbatim; no 'many best bets do' lose", async () => {
    for (const [name, el] of pages.filter(([n]) => n !== "/track-record")) {
      const t = text(await html(el()));
      expect(t, name).toContain(HIT_RATE_VS_PROFIT);
      expect(t, name).not.toMatch(/many best bets do|Plenty still lost/);
    }
  });
});
