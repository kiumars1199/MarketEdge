import { describe, expect, it } from "vitest";
import { gameTime } from "@/lib/format";
describe("gameTime time zone (audit run 2, 3-a)", () => {
  it("renders the same string anywhere when a zone is given", () => {
    const sat = Date.UTC(2026, 10, 21, 20, 30) / 1000;   // Sat 8:30 PM UTC
    const now = Date.UTC(2026, 10, 20, 12);
    expect(gameTime(sat, now, "UTC")).toBe("Sat 8:30 PM");
    expect(gameTime(sat, now, "America/New_York")).toBe("Sat 3:30 PM");
  });
});

describe("visitor zone (T-288)", async () => {
  const { pickZone, validZone, zonedTime } = await import("@/lib/zone");
  it("accepts real IANA zones only", () => {
    for (const z of ["America/New_York", "Asia/Tokyo", "UTC", "Europe/London", "America/Argentina/Buenos_Aires"]) expect(validZone(z)).toBe(z);
    for (const z of ["Mars/Olympus_Mons", "../etc/passwd", "", "America/New York", "a".repeat(65), 5, null, undefined, "<script>"]) expect(validZone(z)).toBeNull();
  });
  it("cookie first, then the Vercel header, else unknown", () => {
    expect(pickZone("Asia%2FTokyo", "America/New_York")).toBe("Asia/Tokyo");
    expect(pickZone("Nowhere/Land", "America/New_York")).toBe("America/New_York");
    expect(pickZone(undefined, "Europe/Paris")).toBe("Europe/Paris");
    expect(pickZone(undefined, "bogus")).toBeNull();
    expect(pickZone(undefined, null)).toBeNull();
  });
  it("gameTime prints a plain space before AM/PM in every zone, as browsers and Node may differ there", () => {
    const sat = Date.UTC(2026, 10, 21, 20, 30) / 1000, now = Date.UTC(2026, 10, 20, 12);
    for (const z of ["UTC", "Asia/Tokyo", "America/New_York"]) expect(gameTime(sat, now, z)).toMatch(/^\w{3} \d{1,2}:\d{2} [AP]M$/);
  });
  it("absolute times on server pages name their zone", () => {
    const t = Date.UTC(2026, 10, 20, 15, 4) / 1000;
    const o = { hour: "numeric", minute: "2-digit" } as const;
    expect(zonedTime(t, "Asia/Tokyo", o)).toBe("12:04 AM GMT+9");
    expect(zonedTime(t, null, o)).toBe("10:04 AM EST");
    expect(zonedTime(t, null, o, "UTC")).toBe("3:04 PM UTC");
  });
});

