// @vitest-environment jsdom
// T-288: times hydrate cleanly in any zone. The server renders with the request's zone and clock (ClockProvider);
// the browser hydrates later (minutes later, in another zone) and must produce the same HTML first, with no
// recoverable hydration error (React #418), then switch to its own zone and the live clock.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClockProvider, ClosesIn, ClosesLine, useWhen } from "./clock";

function Card({ at }: { at: number }) {
  const w = useWhen(at);
  return <p><span data-k="game">{w.game}</span> · <span data-k="closes">{w.closes}</span> · <span data-k="in"><ClosesIn at={at} /></span> · <ClosesLine at={at} cap /></p>;
}
const T = Date.UTC(2026, 10, 20, 14, 59, 50);   // request time: 10 s before a minute (and hour) boundary
const CLOSES = [T / 1000 + 2 * 3600 + 5, T / 1000 + 40 * 60 + 10, T / 1000 + 3 * 86400];
const tree = (zone: string | null, saved: string | null = zone) => (
  <ClockProvider zone={zone} saved={saved} now={T}>{CLOSES.map((c) => <Card key={c} at={c} />)}</ClockProvider>
);

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function hydrate(zone: string | null, browserZone: string, laterMs: number) {
  const html = renderToString(tree(zone));
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  const fetches: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => { fetches.push(String(init?.body)); return new Response(null, { status: 204 }); }));
  vi.useFakeTimers({ now: T + laterMs, toFake: ["Date"] });
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (loc?: string, o?: Intl.DateTimeFormatOptions) { return new real(loc, { timeZone: browserZone, ...o }); } as typeof Intl.DateTimeFormat);
  const errors: unknown[] = [];
  const firstPaint = root.innerHTML;
  await act(async () => { hydrateRoot(root, tree(zone), { onRecoverableError: (e) => errors.push(e) }); });
  vi.restoreAllMocks();
  return { html, firstPaint, errors, after: root.innerHTML, fetches };
}

describe("ClockProvider hydration (T-288)", () => {
  for (const [zone, browser] of [["America/New_York", "Asia/Tokyo"], ["Asia/Tokyo", "Asia/Tokyo"], ["America/New_York", "America/New_York"], [null, "Asia/Tokyo"]] as const) {
    it(`server zone ${zone ?? "unknown"}, browser ${browser}, hydrating 7 min later: no hydration error`, async () => {
      const r = await hydrate(zone, browser, 7 * 60_000);
      expect(r.errors).toEqual([]);
      expect(r.firstPaint).toBe(r.html);
      // the server already rendered real local text when the zone is known; a hidden placeholder otherwise
      if (zone) {
        expect(r.html).not.toContain("data-time-pending");
        const local = new Date(CLOSES[0]! * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: zone }).replace(",", "").replace(/ /g, " ");
        expect(r.html).toContain(local);
      } else {
        expect(r.html).toContain("data-time-pending");
      }
      // after hydration: the browser's zone and the live clock (7 min later: 2h 05m left → 1h 58m → "1h")
      expect(r.after).not.toContain("data-time-pending");
      const local = new Date(CLOSES[0]! * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: browser }).replace(",", "").replace(/ /g, " ");
      expect(r.after).toContain(local);
      expect(r.html).toContain("closes in 2h");
      expect(r.after).toContain("closes in 1h");
      // the browser's zone is sent once when the cookie doesn't hold it
      expect(r.fetches).toEqual(zone === browser ? [] : [JSON.stringify({ tz: browser })]);
    });
  }

  it("server and hydration agree on 'closes in' even across a minute boundary", async () => {
    const r = await hydrate("UTC", "UTC", 15_000);   // the request was at :59:50, hydration at :00:05
    expect(r.errors).toEqual([]);
    expect(r.html).toContain("closes in 40m");
  });
});
