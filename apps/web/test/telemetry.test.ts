import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { cleanProps, cleanUrl, filterKeys, makeBeforeSend, scrubSentryEvent, sentryOptions, track } from "@/lib/telemetry";

describe("Sentry scrubbing", () => {
  it("strips emails, cookies, auth headers and query strings", () => {
    const e = scrubSentryEvent({
      type: undefined,
      message: "failed for jane.doe@example.com",
      user: { id: "u1", email: "jane.doe@example.com", ip_address: "1.2.3.4" },
      request: {
        url: "https://app.test/m/123?token=abc&email=jane@x.com",
        query_string: "token=abc",
        cookies: { sb: "secret" },
        headers: { Authorization: "Bearer x", cookie: "sb=secret", "user-agent": "ua" },
        data: { email: "jane@x.com" },
      },
      exception: { values: [{ type: "Error", value: "no user bob@example.org" }] },
      breadcrumbs: [{ category: "fetch", message: "to a@b.co", data: { url: "/api/x?q=secret" } }],
    } as ErrorEvent);
    const s = JSON.stringify(e);
    for (const bad of ["@example", "jane@", "secret", "Bearer", "token=", "1.2.3.4", "q=secret", "123"]) expect(s).not.toContain(bad);
    expect(e.user).toEqual({ id: "u1" });
    expect(e.request?.headers).toEqual({ "user-agent": "ua" });
    expect(e.request?.url).toBe("https://app.test/m/[id]");
  });

  it("is disabled without a DSN and never sends default PII", () => {
    expect(sentryOptions(undefined)).toMatchObject({ enabled: false, sendDefaultPii: false });
    expect(sentryOptions("https://k@o.ingest.sentry.io/1").enabled).toBe(true);
  });
});

describe("PostHog privacy", () => {
  it("cleanProps keeps only allow-listed, short, email-free values", () => {
    expect(cleanProps({ feature: "alerts", question: "Will X win?", ask: 0.68, plan: "a@b.co", filters: ["categories", "x@y.z"] }))
      .toEqual({ feature: "alerts", filters: ["categories"] });
  });

  it("filterKeys maps URL short keys to filter names, never values", () => {
    expect(filterKeys("https://a.test/markets?c=sports&e=0.05&q=jane%40x.com&pg=2&m=123")).toEqual(["categories", "edge_min", "q"]);
  });

  it("before_send: pageview URLs lose query strings; a same-path pageview becomes filter_used", () => {
    const bs = makeBeforeSend();
    const pv = (url: string) => bs({ event: "$pageview", properties: { $current_url: url, $referrer: `${url}#x`, $pathname: "/markets" }, $set_once: { $initial_current_url: url } });
    const first = pv("https://a.test/markets?c=sports");
    expect(first).toMatchObject({ event: "$pageview", properties: { $current_url: "https://a.test/markets", filters: ["categories"] } });
    expect(JSON.stringify(first)).not.toContain("sports");
    expect(pv("https://a.test/markets?c=crypto&e=0.1")).toMatchObject({ event: "filter_used", properties: { filters: ["categories", "edge_min"] } });
    expect(pv("https://a.test/markets")).toBeNull(); // same page, no filters: not a new page view
    expect(pv("https://a.test/m/555?side=1")?.properties.$current_url).toBe("https://a.test/m/[id]");
    expect(bs({ event: "x", properties: { note: "mail me@home.org" } })?.properties.note).toBe("mail [email]");
  });

  it("track is a no-op while analytics is off", () => {
    expect(() => track("preset_saved", { count: 1 })).not.toThrow();
    expect(cleanUrl("https://a.test/event/9?x=1")).toBe("https://a.test/event/[id]");
  });
});
